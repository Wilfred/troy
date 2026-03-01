import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
} from "discord.js";
import { OpenRouter } from "@openrouter/sdk";
import Database from "better-sqlite3";
import { trustedTools, untrustedTools, handleToolCall } from "./tools.js";
import {
  ConversationEntry,
  openDb,
  writeConversationLog,
  loadRecentHistory,
} from "./conversationlog.js";
import { log } from "./logger.js";
import { buildSystemPrompt } from "./systemprompt.js";

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string | null;
      toolCalls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; content: string; toolCallId: string };

const DISCORD_MAX_LENGTH = 2000;

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", DISCORD_MAX_LENGTH);
    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf(" ", DISCORD_MAX_LENGTH);
    }
    if (splitAt <= 0) {
      splitAt = DISCORD_MAX_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

async function untrustedChatLoop(
  client: OpenRouter,
  model: string,
  messages: ChatMessage[],
  conversationLog: ConversationEntry[],
  toolsUsed: string[],
): Promise<string> {
  const completion = await client.chat.send({
    chatGenerationParams: {
      model,
      messages,
      tools: untrustedTools,
    },
  });

  const choice = completion.choices?.[0];
  const msg = choice?.message;
  if (!msg) {
    return "Sorry, I didn't get a response from the subagent.";
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: msg.content as string | null | undefined,
      toolCalls: msg.toolCalls,
    });

    for (const toolCall of msg.toolCalls) {
      toolsUsed.push(toolCall.function.name);
      conversationLog.push({
        kind: "tool_input",
        name: toolCall.function.name,
        content: toolCall.function.arguments,
      });
      log.info(`Untrusted tool call: ${toolCall.function.name}`);
      const startTime = Date.now();
      try {
        const result = await handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          "",
        );
        const duration_ms = Date.now() - startTime;
        log.info(
          `Untrusted tool completed: ${toolCall.function.name} (${duration_ms}ms)`,
        );
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result,
        });
        conversationLog.push({
          kind: "tool_output",
          name: toolCall.function.name,
          content: result,
          duration_ms,
        });
      } catch (err) {
        const duration_ms = Date.now() - startTime;
        const errorMsg = `Error in ${toolCall.function.name}: ${err instanceof Error ? err.message : String(err)}`;
        log.error(
          `Untrusted tool failed: ${toolCall.function.name} (${duration_ms}ms)`,
        );
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: errorMsg,
        });
        conversationLog.push({
          kind: "tool_output",
          name: toolCall.function.name,
          content: errorMsg,
          duration_ms,
        });
      }
    }

    return untrustedChatLoop(
      client,
      model,
      messages,
      conversationLog,
      toolsUsed,
    );
  }

  return (msg.content as string) || "";
}

async function runUntrustedSubagent(
  client: OpenRouter,
  model: string,
  prompt: string,
  conversationLog: ConversationEntry[],
  toolsUsed: string[],
): Promise<string> {
  log.info("Starting untrusted subagent");
  conversationLog.push({ kind: "response", content: `[subagent] ${prompt}` });

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a helpful assistant. Answer the user's question using the available tools. Be concise.",
    },
    { role: "user", content: prompt },
  ];

  return untrustedChatLoop(client, model, messages, conversationLog, toolsUsed);
}

async function chatLoop(
  client: OpenRouter,
  model: string,
  messages: ChatMessage[],
  notesPath: string,
  toolsUsed: string[],
  toolInputs: Array<{ name: string; args: unknown }>,
  conversationLog: ConversationEntry[],
): Promise<string> {
  const completion = await client.chat.send({
    chatGenerationParams: {
      model,
      messages,
      tools: trustedTools,
    },
  });

  const choice = completion.choices?.[0];
  const msg = choice?.message;
  if (!msg) {
    return "Sorry, I didn't get a response from the model.";
  }

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    if (msg.content) {
      conversationLog.push({
        kind: "response",
        content: msg.content as string,
      });
    }
    messages.push({
      role: "assistant",
      content: msg.content as string | null | undefined,
      toolCalls: msg.toolCalls,
    });

    let delegateResult: string | null = null;
    for (const toolCall of msg.toolCalls) {
      let parsedArgs: unknown = undefined;
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments) as unknown;
      } catch {
        parsedArgs = toolCall.function.arguments;
      }
      toolsUsed.push(toolCall.function.name);
      toolInputs.push({ name: toolCall.function.name, args: parsedArgs });
      conversationLog.push({
        kind: "tool_input",
        name: toolCall.function.name,
        content: JSON.stringify(parsedArgs, null, 2),
      });
      log.info(`Tool call: ${toolCall.function.name}`);

      if (toolCall.function.name === "delegate_to_untrusted") {
        const args = parsedArgs as { prompt: string };
        delegateResult = await runUntrustedSubagent(
          client,
          model,
          args.prompt,
          conversationLog,
          toolsUsed,
        );
        continue;
      }

      const startTime = Date.now();
      try {
        const result = await handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          notesPath,
        );
        const duration_ms = Date.now() - startTime;
        log.info(
          `Tool completed: ${toolCall.function.name} (${duration_ms}ms)`,
        );
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result,
        });
        conversationLog.push({
          kind: "tool_output",
          name: toolCall.function.name,
          content: result,
          duration_ms,
        });
      } catch (err) {
        const duration_ms = Date.now() - startTime;
        const errorMsg = `Error in ${toolCall.function.name}: ${err instanceof Error ? err.message : String(err)}`;
        log.error(`Tool failed: ${toolCall.function.name} (${duration_ms}ms)`);
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: errorMsg,
        });
        conversationLog.push({
          kind: "tool_output",
          name: toolCall.function.name,
          content: errorMsg,
          duration_ms,
        });
      }
    }

    if (delegateResult !== null) {
      return delegateResult;
    }

    return chatLoop(
      client,
      model,
      messages,
      notesPath,
      toolsUsed,
      toolInputs,
      conversationLog,
    );
  }

  return (msg.content as string) || "";
}

async function handleDiscordMessage(
  discordMsg: Message,
  openrouter: OpenRouter,
  model: string,
  dataDir: string,
  db: Database.Database,
): Promise<void> {
  const prompt = discordMsg.content.replace(/<@!?\d+>/g, "").trim();

  if (!prompt) return;

  if (prompt.toLowerCase() === "ping") {
    await discordMsg.reply("pong");
    return;
  }

  log.info(`Discord message from user ${discordMsg.author.id}`);

  try {
    const notesPath = join(dataDir, "rules", "NOTES.md");
    const source = `discord:${discordMsg.channelId}`;
    const history = loadRecentHistory(db, source);

    const systemPrompt = buildSystemPrompt(dataDir);
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    for (const exchange of history) {
      messages.push({ role: "user", content: exchange.user });
      messages.push({ role: "assistant", content: exchange.assistant });
    }
    messages.push({ role: "user", content: prompt });

    const toolsUsed: string[] = [];
    const toolInputs: Array<{ name: string; args: unknown }> = [];
    const conversationLog: ConversationEntry[] = [
      { kind: "prompt", content: prompt },
    ];

    const content = await chatLoop(
      openrouter,
      model,
      messages,
      notesPath,
      toolsUsed,
      toolInputs,
      conversationLog,
    );

    if (!content) {
      await discordMsg.reply("Sorry, I didn't get a response.");
      return;
    }

    conversationLog.push({ kind: "response", content });

    const chatId = writeConversationLog(db, conversationLog, source);

    const toolCount = toolsUsed.length;
    const suffix =
      toolCount > 0
        ? `[C${chatId}, ${toolCount} tool ${toolCount === 1 ? "use" : "uses"}]`
        : `[C${chatId}]`;
    const fullResponse = `${content} ${suffix}`;

    const chunks = splitMessage(fullResponse);
    for (const chunk of chunks) {
      await discordMsg.reply(chunk);
    }
  } catch (err) {
    const stack =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.error(`Error handling Discord message: ${stack}`);
    const errorReply = `Sorry, something went wrong:\n\`\`\`\n${stack}\n\`\`\``;
    const chunks = splitMessage(errorReply);
    for (const chunk of chunks) {
      await discordMsg.reply(chunk);
    }
  }
}

export async function startDiscordBot(
  token: string,
  dataDir: string,
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.error("OPENROUTER_API_KEY environment variable is not set");
    process.exit(1);
  }

  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.6";
  const openrouter = new OpenRouter({ apiKey });

  const rawAllowlist = process.env.DISCORD_ALLOWLIST;
  if (!rawAllowlist) {
    log.warn("DISCORD_ALLOWLIST environment variable is not set");
    process.exit(1);
  }
  const allowlist = new Set(
    rawAllowlist
      .split(",")
      .map((id: string) => id.trim())
      .filter(Boolean),
  );

  mkdirSync(join(dataDir, "rules"), { recursive: true });
  mkdirSync(join(dataDir, "skills"), { recursive: true });

  const db = openDb(dataDir);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.once(Events.ClientReady, (c) => {
    log.info(`Logged in as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (msg.author.bot) return;

      if (!allowlist.has(msg.author.id)) return;

      const isDM = !msg.guild;
      const isMentioned = msg.mentions.has(client.user!);

      if (!isDM && !isMentioned) return;

      await handleDiscordMessage(msg, openrouter, model, dataDir, db);
    } catch (err) {
      const stack =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      log.error(`Unhandled error in MessageCreate handler: ${stack}`);
    }
  });

  await client.login(token);
}
