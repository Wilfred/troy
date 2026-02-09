import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { OpenRouter } from "@openrouter/sdk";

const { values } = parseArgs({
  options: {
    prompt: { type: "string", short: "p" },
  },
});

if (!values.prompt) {
  console.error("Usage: troy --prompt <string>");
  process.exit(1);
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

let systemPrompt = readFileSync(
  new URL("../SYSTEM.md", import.meta.url),
  "utf-8",
);

const privatePath = new URL("../SYSTEM.private.md", import.meta.url);
if (existsSync(privatePath)) {
  systemPrompt += "\n" + readFileSync(privatePath, "utf-8");
}

const client = new OpenRouter({ apiKey });

const completion = await client.chat.send({
  chatGenerationParams: {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: values.prompt },
    ],
  },
});

const content = completion.choices?.[0]?.message?.content;
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
