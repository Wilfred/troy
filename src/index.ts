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

console.log(values.prompt);
