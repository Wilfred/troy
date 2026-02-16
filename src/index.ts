import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { OpenRouter } from "@openrouter/sdk";
import { getRecentMessages } from "./messages.js";
import { tools, handleToolCall } from "./tools.js";
import { startDiscordBot } from "./discord.js";
import {
  ConversationEntry,
  nextChatId,
  writeConversationLog,
} from "./conversationlog.js";

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

function getInitialSentence(prompt: string): string {
  const match = /^[^.!?]*[.!?]?/.exec(prompt);
  return match ? match[0].toLowerCase() : prompt.toLowerCase();
}

function loadMatchingSkills(skillsDir: string, prompt: string): string[] {
  if (!existsSync(skillsDir)) return [];
  const sentence = getInitialSentence(prompt);
  const files = readdirSync(skillsDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort();
  const result: string[] = [];
  for (const file of files) {
    const skillName = file
      .replace(/\.md$/, "")
      .replace(/[-_]/g, " ")
      .toLowerCase();
    const words: string[] = skillName
      .split(/\s+/)
      .filter((w: string) => w.length > 2);
    if (words.some((w: string) => sentence.includes(w))) {
      result.push(readFileSync(join(skillsDir, file), "utf-8"));
    }
  }
  return result;
}

function buildSystemPrompt(
  dataDir: string,
  messagesFile?: string,
  prompt?: string,
): string {
  let systemPrompt = readFileSync(
    new URL("../SYSTEM.md", import.meta.url),
    "utf-8",
  );

  const rulesDir = join(dataDir, "rules");
  if (existsSync(rulesDir)) {
    const mdFiles = readdirSync(rulesDir)
      .filter((f: string) => f.endsWith(".md"))
      .sort();
    for (const file of mdFiles) {
      systemPrompt += "\n\n" + readFileSync(join(rulesDir, file), "utf-8");
    }
  }

  if (prompt) {
    const skillsDir = join(dataDir, "skills");
    for (const content of loadMatchingSkills(skillsDir, prompt)) {
      systemPrompt += "\n\n" + content;
    }
  }

  const currentDate = new Date().toISOString().slice(0, 10);
  systemPrompt += `\n\nToday's date is ${currentDate}.`;

  const currentUser = process.env.USER;
  if (currentUser) {
    systemPrompt += `\nThe current user's name is ${currentUser}.`;
  }

  if (messagesFile) {
    const recentMessages = getRecentMessages(messagesFile, 20);
    if (recentMessages) {
      systemPrompt += `\n\n## Recent messages\n\n${recentMessages}`;
    }
  }

  return systemPrompt;
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
      tools,
    },
  });

  const choice = completion.choices?.[0];
  const msg = choice?.message;
  if (!msg) {
    console.error("Error: No response from model");
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

    for (const toolCall of msg.toolCalls) {
      let parsedArgs: unknown;
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
      try {
        const result = await handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          notesPath,
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
        });
      } catch (err) {
        const errorMsg = `Error in ${toolCall.function.name}: ${err instanceof Error ? err.message : String(err)}`;
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: errorMsg,
        });
        conversationLog.push({
          kind: "tool_output",
          name: toolCall.function.name,
          content: errorMsg,
        });
      }
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

async function runAction(opts: {
  prompt: string;
  messages?: string;
  dataDir?: string;
}): Promise<void> {
  const dataDir = getDataDir(opts.dataDir);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENROUTER_API_KEY environment variable is not set");
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

  const client = new OpenRouter({ apiKey });
  const notesPath = join(dataDir, "rules", "NOTES.md");

  const messages: Message[] = [
    {
      role: "system",
      content: buildSystemPrompt(dataDir, opts.messages, opts.prompt),
    },
    { role: "user", content: opts.prompt },
  ];

  const toolsUsed: string[] = [];
  const toolInputs: Array<{ name: string; args: unknown }> = [];
  const conversationLog: ConversationEntry[] = [
    { kind: "prompt", content: opts.prompt },
  ];
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
    console.error("Error: No response content from model");
    process.exit(1);
  }

  conversationLog.push({ kind: "response", content });

  const logDir = join(homedir(), ".troy");
  mkdirSync(logDir, { recursive: true });
  const chatId = nextChatId(logDir);
  writeConversationLog(logDir, chatId, conversationLog);

  const toolCount = toolsUsed.length;
  const suffix =
    toolCount > 0
      ? `[C${chatId}, ${toolCount} tool ${toolCount === 1 ? "use" : "uses"}]`
      : `[C${chatId}]`;
  console.log(`${content} ${suffix}`);
}

function printSystemAction(opts: {
  messages?: string;
  dataDir?: string;
}): void {
  const dataDir = getDataDir(opts.dataDir);
  const systemPrompt = buildSystemPrompt(dataDir, opts.messages);
  console.log(systemPrompt);
}

function showAction(rawId: string): void {
  const numericId = Number(rawId.replace(/^C/i, ""));
  if (!Number.isInteger(numericId) || numericId <= 0) {
    console.error(`Error: invalid conversation ID "${rawId}"`);
    process.exit(1);
    return;
  }

  const logDir = join(homedir(), ".troy");
  const logPath = join(logDir, "logs", `C${numericId}.log`);
  if (!existsSync(logPath)) {
    console.error(`Error: no conversation found with ID ${numericId}`);
    process.exit(1);
    return;
  }

  console.log(readFileSync(logPath, "utf-8"));
}

async function discordAction(opts: { dataDir?: string }): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("Error: DISCORD_BOT_TOKEN environment variable is not set");
    process.exit(1);
  }

  const dataDir = getDataDir(opts.dataDir);
  await startDiscordBot(token, dataDir);
}

async function main(): Promise<void> {
  const program = new Command();

  program.name("troy").description("Agentic helper bot powered by OpenRouter");

  program
    .command("run")
    .description("Send a prompt to the model")
    .requiredOption("-p, --prompt <string>", "the prompt to send to the model")
    .option("-m, --messages <file>", "path to a messages JSON file for context")
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
    .command("print-system")
    .description("Print the system prompt and exit")
    .option("-m, --messages <file>", "path to a messages JSON file for context")
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .action(printSystemAction);

  program
    .command("show")
    .description("Look up a conversation by ID and print its log")
    .argument("<id>", "conversation ID, e.g. C123 or 123")
    .action(showAction);

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
  DISCORD_ALLOWLIST        Comma-separated Discord user IDs allowed to use the bot (optional; if unset, all users are allowed)`,
    )
    .action(discordAction);

  await program.parseAsync();
}

main();
