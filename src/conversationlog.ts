import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ConversationEntry =
  | { kind: "prompt"; content: string }
  | { kind: "response"; content: string }
  | { kind: "tool_input"; name: string; content: string }
  | { kind: "tool_output"; name: string; content: string; duration_ms: number };

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
      return `Tool Output name=${entry.name} duration=${entry.duration_ms}ms:\n${indentBlock(entry.content)}`;
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

function nextChatId(logDir: string): number {
  const dir = join(logDir, "logs");
  if (!existsSync(dir)) return 1;
  const files = readdirSync(dir);
  const ids = files
    .map((f: string) => /^C(\d+)\.log$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

function parseConversationLog(text: string): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const headerRe =
    /^(Prompt|Response|Tool Input|Tool Output)(?: name=(\S+?))?(?: duration=(\d+)ms)?:$/;
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const match = headerRe.exec(lines[i]);
    if (!match) {
      i++;
      continue;
    }

    const kind = match[1];
    const name = match[2] ?? "";
    const durationStr = match[3];
    i++;

    const contentLines: string[] = [];
    while (i < lines.length) {
      if (lines[i].startsWith("  ")) {
        contentLines.push(lines[i].slice(2));
        i++;
      } else if (lines[i] === "") {
        // Peek ahead: if next line is indented, it's a blank line within the block.
        if (i + 1 < lines.length && lines[i + 1].startsWith("  ")) {
          contentLines.push("");
          i++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    const content = contentLines.join("\n");

    if (kind === "Prompt") {
      entries.push({ kind: "prompt", content });
    } else if (kind === "Response") {
      entries.push({ kind: "response", content });
    } else if (kind === "Tool Input") {
      entries.push({ kind: "tool_input", name, content });
    } else if (kind === "Tool Output") {
      entries.push({
        kind: "tool_output",
        name,
        content,
        duration_ms: durationStr ? Number(durationStr) : 0,
      });
    }
  }

  return entries;
}

export {
  ConversationEntry,
  formatConversationLog,
  nextChatId,
  parseConversationLog,
  writeConversationLog,
};
