import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { OpenRouter } from "@openrouter/sdk";
import { getAllMessages, getRecentMessages } from "./messages.js";

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
  {
    type: "function" as const,
    function: {
      name: "edit_note",
      description:
        "Edit the user's NOTES.md file by replacing existing text with new text. Use this to update, correct, or remove outdated notes.",
      parameters: {
        type: "object",
        properties: {
          old_text: {
            type: "string",
            description: "The existing text in NOTES.md to find and replace",
          },
          new_text: {
            type: "string",
            description:
              "The replacement text. Use an empty string to delete the old text.",
          },
        },
        required: ["old_text", "new_text"],
      },
    },
  },
];

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
      } else if (toolCall.function.name === "edit_note") {
        const args = JSON.parse(toolCall.function.arguments) as {
          old_text: string;
          new_text: string;
        };
        const current = existsSync(notesPath)
          ? readFileSync(notesPath, "utf-8")
          : "";
        if (!current.includes(args.old_text)) {
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: "Error: old_text not found in NOTES.md.",
          });
        } else {
          const updated = current.replace(args.old_text, args.new_text);
          writeFileSync(notesPath, updated, "utf-8");
          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: "Done.",
          });
        }
      }
    }

    return chat(client, model, messages, notesPath);
  }

  return (msg.content as string) || "";
}

async function main() {
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
    .action(
      async (opts: { prompt: string; messages?: string; dataDir?: string }) => {
        const dataDir = getDataDir(opts.dataDir);

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
        const model =
          process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.6";

        const client = new OpenRouter({ apiKey });
        const notesPath = join(dataDir, "rules", "NOTES.md");

        const messages: Message[] = [
          {
            role: "system",
            content: buildSystemPrompt(dataDir, opts.messages, opts.prompt),
          },
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
      },
    );

  program
    .command("print-system")
    .description("Print the system prompt and exit")
    .option("-m, --messages <file>", "path to a messages JSON file for context")
    .option(
      "-d, --data-dir <path>",
      "data directory for .md files (default: ~/troy_data)",
    )
    .action((opts: { messages?: string; dataDir?: string }) => {
      const dataDir = getDataDir(opts.dataDir);
      const systemPrompt = buildSystemPrompt(dataDir, opts.messages);
      console.log(systemPrompt);
    });

  program
    .command("import")
    .description("Import past messages and update notes based on them")
    .requiredOption(
      "-m, --messages <file>",
      "path to a messages JSON file to import",
    )
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
    .action(async (opts: { messages: string; dataDir?: string }) => {
      const dataDir = getDataDir(opts.dataDir);

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        console.error(
          "Error: OPENROUTER_API_KEY environment variable is not set",
        );
        process.exit(1);
      }

      const model = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-4.6";

      const client = new OpenRouter({ apiKey });
      const notesPath = join(dataDir, "rules", "NOTES.md");

      const formattedMessages = getAllMessages(opts.messages);
      const existingNotes = existsSync(notesPath)
        ? readFileSync(notesPath, "utf-8")
        : "";

      const prompt =
        `Review the following chat history and update your notes with any useful information about the users, their preferences, important facts, or anything worth remembering for future conversations.\n\n` +
        `## Current notes\n\n${existingNotes || "(empty)"}\n\n` +
        `## Chat history\n\n${formattedMessages}\n\n` +
        `Use the append_note tool to save anything new you've learned. Do not duplicate information already in your notes.`;

      const messages: Message[] = [
        { role: "system", content: buildSystemPrompt(dataDir) },
        { role: "user", content: prompt },
      ];

      const content = await chat(client, model, messages, notesPath);
      if (content) {
        console.log(content);
      }
    });

  await program.parseAsync();
}

main();
