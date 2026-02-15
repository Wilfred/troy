import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ConversationEntry =
  | { kind: "prompt"; content: string }
  | { kind: "response"; content: string }
  | { kind: "tool_input"; name: string; content: string }
  | { kind: "tool_output"; name: string; content: string };

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => "  " + line)
    .join("\n");
}

function formatEntry(entry: ConversationEntry): string {
  switch (entry.kind) {
    case "prompt":
      return `Prompt:\n${indentBlock(entry.content)}`;
    case "response":
      return `Response:\n${indentBlock(entry.content)}`;
    case "tool_input":
      return `Tool Input name=${entry.name}:\n${indentBlock(entry.content)}`;
    case "tool_output":
      return `Tool Output name=${entry.name}:\n${indentBlock(entry.content)}`;
  }
}

function formatConversationLog(entries: ConversationEntry[]): string {
  return entries.map(formatEntry).join("\n\n") + "\n";
}

function writeConversationLog(
  logDir: string,
  chatId: number,
  entries: ConversationEntry[],
): string {
  const dir = join(logDir, "logs");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `C${chatId}.log`);
  writeFileSync(filePath, formatConversationLog(entries), "utf-8");
  return filePath;
}

export { ConversationEntry, formatConversationLog, writeConversationLog };
