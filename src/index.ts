import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { OpenRouter } from "@openrouter/sdk";
import { getAllMessages, getRecentMessages } from "./messages.js";
import { initDb, logRequest, getRequest } from "./db.js";
import { tools, handleToolCall } from "./tools.js";
import { startDiscordBot } from "./discord.js";

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
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments) as unknown;
      } catch {
        parsedArgs = toolCall.function.arguments;
      }
      toolsUsed.push(toolCall.function.name);
      toolInputs.push({ name: toolCall.function.name, args: parsedArgs });
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
      } catch (err) {
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: `Error in ${toolCall.function.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return chat(client, model, messages, notesPath, toolsUsed, toolInputs);
  }

  return (msg.content as string) || "";
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

        const toolsUsed: string[] = [];
        const toolInputs: Array<{ name: string; args: unknown }> = [];
        const startTime = Date.now();
        const content = await chat(
          client,
          model,
          messages,
          notesPath,
          toolsUsed,
          toolInputs,
        );
        const durationMs = Date.now() - startTime;

        if (!content) {
          console.error("Error: No response content from model");
          process.exit(1);
        }

        const logDir = join(homedir(), ".troy");
        mkdirSync(logDir, { recursive: true });
        const dataSource = await initDb(join(logDir, "history.db"));
        const chatId = await logRequest(dataSource, {
          timestamp: new Date().toISOString(),
          model,
          command: "run",
          prompt: opts.prompt,
          toolsUsed,
          toolInputs,
          response: content,
          durationMs,
        });
        await dataSource.destroy();

        const toolCount = toolsUsed.length;
        const suffix =
          toolCount > 0
            ? `[C${chatId}, ${toolCount} tool ${toolCount === 1 ? "use" : "uses"}]`
            : `[C${chatId}]`;
        console.log(`${content} ${suffix}`);
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

      const toolsUsed: string[] = [];
      const toolInputs: Array<{ name: string; args: unknown }> = [];
      const startTime = Date.now();
      const content = await chat(
        client,
        model,
        messages,
        notesPath,
        toolsUsed,
        toolInputs,
      );
      const durationMs = Date.now() - startTime;

      const logDir = join(homedir(), ".troy");
      mkdirSync(logDir, { recursive: true });
      const dataSource = await initDb(join(logDir, "history.db"));
      const chatId = await logRequest(dataSource, {
        timestamp: new Date().toISOString(),
        model,
        command: "import",
        prompt,
        toolsUsed,
        toolInputs,
        response: content,
        durationMs,
      });
      await dataSource.destroy();

      if (content) {
        const toolCount = toolsUsed.length;
        const suffix =
          toolCount > 0
            ? `[C${chatId}, ${toolCount} tool ${toolCount === 1 ? "use" : "uses"}]`
            : `[C${chatId}]`;
        console.log(`${content} ${suffix}`);
      }
    });

  program
    .command("show")
    .description("Look up a conversation by ID and print its data")
    .argument("<id>", "conversation ID, e.g. C123 or 123")
    .action(async (rawId: string) => {
      const numericId = Number(rawId.replace(/^C/i, ""));
      if (!Number.isInteger(numericId) || numericId <= 0) {
        console.error(`Error: invalid conversation ID "${rawId}"`);
        process.exit(1);
        return;
      }

      const logDir = join(homedir(), ".troy");
      const dataSource = await initDb(join(logDir, "history.db"));
      const row = await getRequest(dataSource, numericId);
      await dataSource.destroy();

      if (!row) {
        console.error(`Error: no conversation found with ID ${numericId}`);
        process.exit(1);
        return;
      }

      const toolsUsed = row.toolsUsed
        ? (JSON.parse(row.toolsUsed) as string[]).join(", ")
        : "(none)";

      const toolInputs = row.toolInputs
        ? JSON.stringify(
            JSON.parse(row.toolInputs) as Array<{
              name: string;
              args: unknown;
            }>,
            null,
            2,
          )
        : "(none)";

      const entries: [string, string][] = [
        ["ID", `C${row.id}`],
        ["Timestamp", row.timestamp],
        ["Model", row.model],
        ["Command", row.command],
        ["Duration", `${row.durationMs}ms`],
        ["Tools Used", toolsUsed],
        ["Tool Inputs", toolInputs],
        ["Prompt", row.prompt],
        ["Response", row.response],
      ];

      const keyWidth = Math.max(...entries.map(([k]) => k.length));
      const separator = "-".repeat(keyWidth + 3 + 60);

      console.log(separator);
      for (const [key, value] of entries) {
        console.log(`${key.padEnd(keyWidth)} | ${value}`);
        console.log(separator);
      }
    });

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
  OPENROUTER_MODEL         Model to use (default: anthropic/claude-opus-4.6)`,
    )
    .action(async (opts: { dataDir?: string }) => {
      const token = process.env.DISCORD_BOT_TOKEN;
      if (!token) {
        console.error(
          "Error: DISCORD_BOT_TOKEN environment variable is not set",
        );
        process.exit(1);
      }

      const dataDir = getDataDir(opts.dataDir);
      await startDiscordBot(token, dataDir);
    });

  await program.parseAsync();
}

main();
