import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { OpenRouter } from "@openrouter/sdk";
import { getRecentMessages } from "./messages.js";

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

const tools = [
  {
    type: "function" as const,
    function: {
      name: "append_note",
      description:
        "Append text to the user's NOTES.md file. Use this to save information the user asks you to remember.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to append to NOTES.md",
          },
        },
        required: ["text"],
      },
    },
  },
];

function getDataDir(dataDir?: string): string {
  const dir = dataDir || join(homedir(), "troy_data");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildSystemPrompt(dataDir: string, messagesFile?: string): string {
  let systemPrompt = readFileSync(
    new URL("../SYSTEM.md", import.meta.url),
    "utf-8",
  );

  if (existsSync(dataDir)) {
    const mdFiles = readdirSync(dataDir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const file of mdFiles) {
      systemPrompt += "\n\n" + readFileSync(join(dataDir, file), "utf-8");
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
    messages.push({
      role: "assistant",
      content: msg.content as string | null | undefined,
      toolCalls: msg.toolCalls,
    });

    for (const toolCall of msg.toolCalls) {
      if (toolCall.function.name === "append_note") {
        const args = JSON.parse(toolCall.function.arguments) as {
          text: string;
        };
        appendFileSync(notesPath, args.text + "\n", "utf-8");
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: "Done.",
        });
      }
    }

    return chat(client, model, messages, notesPath);
  }

  return (msg.content as string) || "";
}

async function main() {
  const program = new Command();

  program
    .name("troy")
    .description("Agentic helper bot powered by OpenRouter")
    .requiredOption("-p, --prompt <string>", "the prompt to send to the model")
    .option("-m, --messages <file>", "path to a messages JSON file for context")
    .option("-d, --data-dir <path>", "data directory for .md files (default: ~/troy_data)")
    .option("--print-system-prompt", "print the system prompt and exit")
    .addHelpText(
      "after",
      `
Environment variables:
  OPENROUTER_API_KEY       API key for OpenRouter (required)
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)`,
    );

  program.parse();
  const opts = program.opts<{
    prompt: string;
    messages?: string;
    dataDir?: string;
    printSystemPrompt?: boolean;
  }>();

  const dataDir = getDataDir(opts.dataDir);

  if (opts.printSystemPrompt) {
    const systemPrompt = buildSystemPrompt(dataDir, opts.messages);
    console.log(systemPrompt);
    process.exit(0);
  }

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
  const notesPath = join(dataDir, "NOTES.md");

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt(dataDir, opts.messages) },
    { role: "user", content: opts.prompt },
  ];

  const content = await chat(client, model, messages, notesPath);
  if (!content) {
    console.error("Error: No response content from model");
    process.exit(1);
  }

  console.log(content);

  const logDir = join(homedir(), ".troy");
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, "history.log");
  const timestamp = new Date().toISOString();
  appendFileSync(
    logFile,
    `--- ${timestamp} [${model}] ---\n> ${opts.prompt}\n${content}\n\n`,
  );
}

main();
