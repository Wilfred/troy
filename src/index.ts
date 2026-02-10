import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
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

function buildSystemPrompt(messagesFile?: string): string {
  let systemPrompt = readFileSync(
    new URL("../SYSTEM.md", import.meta.url),
    "utf-8",
  );

  const privatePath = new URL("../SYSTEM.private.md", import.meta.url);
  if (existsSync(privatePath)) {
    systemPrompt += "\n" + readFileSync(privatePath, "utf-8");
  }

  const notesPath = new URL("../NOTES.md", import.meta.url);
  if (existsSync(notesPath)) {
    systemPrompt += "\n\n## Notes\n\n" + readFileSync(notesPath, "utf-8");
  }

  const currentUser = process.env.USER;
  if (currentUser) {
    systemPrompt += `\n\nThe current user's name is ${currentUser}.`;
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
  notesPath: URL,
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
  const { values } = parseArgs({
    options: {
      prompt: { type: "string", short: "p" },
      messages: { type: "string", short: "m" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(
      `Usage: troy --prompt <string> [options]

Options:
  -p, --prompt <string>    The prompt to send to the model (required)
  -m, --messages <file>    Path to a messages JSON file for context
  -h, --help               Show this help message

Environment variables:
  OPENROUTER_API_KEY       API key for OpenRouter (required)
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)`,
    );
    process.exit(0);
  }

  if (!values.prompt) {
    console.error("Usage: troy --prompt <string> (see --help for details)");
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(
      "Error: OPENROUTER_API_KEY environment variable is not set",
    );
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
  const notesPath = new URL("../NOTES.md", import.meta.url);

  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt(values.messages) },
    { role: "user", content: values.prompt },
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
    `--- ${timestamp} [${model}] ---\n> ${values.prompt}\n${content}\n\n`,
  );
}

main();
