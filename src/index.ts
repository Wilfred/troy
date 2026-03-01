import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { Command } from "commander";
import { OpenRouter } from "@openrouter/sdk";
import { trustedTools, untrustedTools, handleToolCall } from "./tools.js";
import { startDiscordBot } from "./discord.js";
import {
  ConversationEntry,
  openDb,
  writeConversationLog,
  loadRecentHistory,
} from "./conversationlog.js";
import { log } from "./logger.js";
import { buildSystemPrompt } from "./systemprompt.js";

type Message =
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

function getDataDir(dataDir?: string): string {
  const dir = dataDir || join(homedir(), "troy_data");
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "skills"), { recursive: true });
  return dir;
}

async function untrustedChat(
  client: OpenRouter,
  model: string,
  messages: Message[],
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
    log.error("No response from untrusted subagent");
    return "Error: no response from subagent.";
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

    return untrustedChat(client, model, messages, conversationLog, toolsUsed);
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

  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a helpful assistant. Answer the user's question using the available tools. Be concise.",
    },
    { role: "user", content: prompt },
  ];

  return untrustedChat(client, model, messages, conversationLog, toolsUsed);
}

async function chat(
  client: OpenRouter,
  model: string,
  messages: Message[],
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
    log.error("No response from model");
    process.exit(1);
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
      log.info(`Trusted tool call: ${toolCall.function.name}`);

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
          `Trusted tool completed: ${toolCall.function.name} (${duration_ms}ms)`,
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
          `Trusted tool failed: ${toolCall.function.name} (${duration_ms}ms)`,
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

    if (delegateResult !== null) {
      return delegateResult;
    }

    return chat(
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

async function replAction(opts: { dataDir?: string }): Promise<void> {
  const dataDir = getDataDir(opts.dataDir);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.error("OPENROUTER_API_KEY environment variable is not set");
    process.exit(1);
  }

  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.6";
  log.info(`Starting REPL with model ${model}`);

  const client = new OpenRouter({ apiKey });
  const notesPath = join(dataDir, "rules", "NOTES.md");

  const db = openDb(dataDir);
  const history = loadRecentHistory(db);

  const messages: Message[] = [
    {
      role: "system",
      content: buildSystemPrompt(dataDir),
    },
  ];
  for (const exchange of history) {
    messages.push({ role: "user", content: exchange.user });
    messages.push({ role: "assistant", content: exchange.assistant });
  }

  const toolsUsed: string[] = [];
  const toolInputs: Array<{ name: string; args: unknown }> = [];

  const rl = createInterface({ input: processStdin, output: processStdout });

  processStdout.write('Troy REPL (Ctrl+D or "exit" to quit)\n\n');

  while (true) {
    let userInput = "";
    try {
      userInput = await rl.question("> ");
    } catch {
      break;
    }

    const trimmed = userInput.trim();
    if (trimmed === "exit" || trimmed === "quit") break;
    if (!trimmed) continue;

    if (trimmed.toLowerCase() === "ping") {
      processStdout.write("\npong\n\n");
      continue;
    }

    const conversationLog: ConversationEntry[] = [
      { kind: "prompt", content: trimmed },
    ];
    messages.push({ role: "user", content: trimmed });

    let content = "";
    try {
      content = await chat(
        client,
        model,
        messages,
        notesPath,
        toolsUsed,
        toolInputs,
        conversationLog,
      );
    } catch (err) {
      log.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      messages.pop();
      continue;
    }

    if (!content) {
      log.error("No response content from model");
      continue;
    }

    conversationLog.push({ kind: "response", content });
    messages.push({ role: "assistant", content });

    const chatId = writeConversationLog(db, conversationLog);
    log.info(`Saved exchange as C${chatId}`);

    processStdout.write(`\n${content}\n\n`);
  }

  rl.close();
}

async function runAction(opts: {
  prompt?: string;
  dataDir?: string;
}): Promise<void> {
  if (!opts.prompt) {
    return replAction(opts);
  }

  if (opts.prompt.trim().toLowerCase() === "ping") {
    console.log("pong");
    return;
  }

  const dataDir = getDataDir(opts.dataDir);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    log.error("OPENROUTER_API_KEY environment variable is not set");
    process.exit(1);
  }

  // openai/gpt-4o-mini: too generic and seemed to ignore system prompt.
  // anthropic/claude-opus-4.5: decent results
  //
  // google/gemini-2.5-pro: looks like it googled things? not what I wanted.
  //
  // openai/gpt-5.2: decent, a little slow, asked follow-up questions
  //
  // anthropic/claude-sonnet-4.5: OK, not as good as opus, asked
  // follow-up questions.
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.6";
  log.info(`Starting run with model ${model} (trusted mode)`);

  const client = new OpenRouter({ apiKey });
  const notesPath = join(dataDir, "rules", "NOTES.md");

  const db = openDb(dataDir);
  const history = loadRecentHistory(db);

  const messages: Message[] = [
    {
      role: "system",
      content: buildSystemPrompt(dataDir, opts.prompt),
    },
  ];
  for (const exchange of history) {
    messages.push({ role: "user", content: exchange.user });
    messages.push({ role: "assistant", content: exchange.assistant });
  }
  messages.push({ role: "user", content: opts.prompt });

  const toolsUsed: string[] = [];
  const toolInputs: Array<{ name: string; args: unknown }> = [];
  const conversationLog: ConversationEntry[] = [
    { kind: "prompt", content: opts.prompt },
  ];
  log.info("Starting trusted agent");
  const content = await chat(
    client,
    model,
    messages,
    notesPath,
    toolsUsed,
    toolInputs,
    conversationLog,
  );

  if (!content) {
    log.error("No response content from model");
    process.exit(1);
  }

  conversationLog.push({ kind: "response", content });

  const chatId = writeConversationLog(db, conversationLog);

  const toolCount = toolsUsed.length;
  const suffix =
    toolCount > 0
      ? `[C${chatId}, ${toolCount} tool ${toolCount === 1 ? "use" : "uses"}]`
      : `[C${chatId}]`;
  log.info(`Completed C${chatId} with ${toolCount} tool use(s)`);
  console.log(`${content} ${suffix}`);
}

async function discordAction(opts: { dataDir?: string }): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    log.error("DISCORD_BOT_TOKEN environment variable is not set");
    process.exit(1);
  }

  log.info("Starting Discord bot");
  const dataDir = getDataDir(opts.dataDir);
  await startDiscordBot(token, dataDir);
}

async function main(): Promise<void> {
  const program = new Command();

  program.name("troy").description("Agentic helper bot powered by OpenRouter");

  program
    .command("run")
    .description(
      "Send a prompt to the model, or start a REPL if no prompt is given",
    )
    .option("-p, --prompt <string>", "the prompt to send to the model")
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .addHelpText(
      "after",
      `
Environment variables:
  OPENROUTER_API_KEY       API key for OpenRouter (required)
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)`,
    )
    .action(runAction);

  program
    .command("discord")
    .description("Run Troy as a Discord bot")
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .addHelpText(
      "after",
      `
Environment variables:
  DISCORD_BOT_TOKEN        Discord bot token (required)
  OPENROUTER_API_KEY       API key for OpenRouter (required)
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)
  DISCORD_ALLOWLIST        Comma-separated Discord user IDs allowed to use the bot (required)`,
    )
    .action(discordAction);

  await program.parseAsync();
}

main();
