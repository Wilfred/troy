import { parseArgs } from "node:util";

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

const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: values.prompt }],
  }),
});

if (!response.ok) {
  console.error(`Error: OpenRouter API returned ${response.status} ${response.statusText}`);
  process.exit(1);
}

const data = (await response.json()) as {
  choices: Array<{ message: { content: string } }>;
};

const content = data.choices?.[0]?.message?.content;
if (!content) {
  console.error("Error: No response content from model");
  process.exit(1);
}

console.log(content);
