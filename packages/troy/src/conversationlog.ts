import { DataSource } from "typeorm";
import {
  Conversation,
  Exchange,
  StoredMessage,
  appendExchange,
} from "@troy/shared";
import { parseStoredDate } from "./dates.js";

export { loadRecentHistory } from "@troy/shared";
export { openConversationDb as openDb } from "@troy/shared";

export type ConversationEntry =
  | { kind: "system"; content: string }
  | { kind: "skills"; filenames: string[] }
  | { kind: "history"; role: "user" | "assistant"; content: string }
  | { kind: "history_tool_input"; name: string; content: string }
  | { kind: "history_tool_output"; name: string; content: string }
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
    case "system":
      return `System:\n${indentBlock(entry.content)}`;
    case "skills":
      if (entry.filenames.length === 0) {
        return "Skills:\n  (none)";
      }
      return `Skills:\n${entry.filenames.map((f) => `  - ${f}`).join("\n")}`;
    case "history":
      return `History ${entry.role}:\n${indentBlock(entry.content)}`;
    case "history_tool_input":
      return `History tool input name=${entry.name}:\n${indentBlock(entry.content)}`;
    case "history_tool_output":
      return `History tool output name=${entry.name}:\n${indentBlock(entry.content)}`;
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

function toolNameById(messages: StoredMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const tc of m.toolCalls) {
        map.set(tc.id, tc.function.name);
      }
    }
  }
  return map;
}

function entriesForExchange(exchange: Exchange): ConversationEntry[] {
  const out: ConversationEntry[] = [];
  if (exchange.messages.length === 0) {
    out.push({ kind: "history", role: "user", content: exchange.user });
    out.push({
      kind: "history",
      role: "assistant",
      content: exchange.assistant,
    });
    return out;
  }
  const nameById = toolNameById(exchange.messages);
  for (const m of exchange.messages) {
    if (m.role === "user") {
      out.push({ kind: "history", role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (m.toolCalls && m.toolCalls.length > 0) {
        if (m.content) {
          out.push({
            kind: "history",
            role: "assistant",
            content: m.content,
          });
        }
        for (const tc of m.toolCalls) {
          out.push({
            kind: "history_tool_input",
            name: tc.function.name,
            content: tc.function.arguments,
          });
        }
      } else {
        out.push({
          kind: "history",
          role: "assistant",
          content: (m.content as string) ?? "",
        });
      }
    } else {
      out.push({
        kind: "history_tool_output",
        name: nameById.get(m.toolCallId) ?? "unknown",
        content: m.content,
      });
    }
  }
  return out;
}

export function buildContextEntries(
  systemPrompt: string,
  history: Exchange[],
): ConversationEntry[] {
  const entries: ConversationEntry[] = [
    { kind: "system", content: systemPrompt },
  ];
  for (const exchange of history) {
    entries.push(...entriesForExchange(exchange));
  }
  return entries;
}

export function formatConversationLog(entries: ConversationEntry[]): string {
  return entries.map(formatEntry).join("\n\n") + "\n";
}

export function loadConversationEntries(
  row: Pick<ConversationRow, "entries">,
): ConversationEntry[] | null {
  if (!row.entries) return null;
  return JSON.parse(row.entries) as ConversationEntry[];
}

export async function writeConversationLog(
  ds: DataSource,
  entries: ConversationEntry[],
  source?: string,
  messages?: StoredMessage[],
  totalDurationMs?: number,
): Promise<number> {
  const promptEntry = entries.find((e) => e.kind === "prompt");
  const responseEntries = entries.filter((e) => e.kind === "response");
  const lastResponse = responseEntries[responseEntries.length - 1];
  const prompt = promptEntry?.content ?? "";
  const response = lastResponse?.content ?? "";
  return appendExchange(ds, {
    source,
    prompt,
    response,
    content: formatConversationLog(entries),
    entries: JSON.stringify(entries),
    messages,
    totalDurationMs,
  });
}

export type ConversationRow = {
  id: number;
  source: string;
  prompt: string;
  response: string;
  content: string;
  entries: string | null;
  messages: string | null;
  total_duration_ms: number | null;
  created_at: Date;
};

function toConversationRow(row: Conversation): ConversationRow {
  return {
    id: row.id,
    source: row.source,
    prompt: row.prompt,
    response: row.response,
    content: row.content,
    entries: row.entries,
    messages: row.messages,
    total_duration_ms: row.total_duration_ms,
    created_at: parseStoredDate(row.created_at),
  };
}

export function sumToolDurationMs(entries: ConversationEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.kind === "tool_output") {
      total += entry.duration_ms;
    }
  }
  return total;
}

export async function listConversations(
  ds: DataSource,
  limit: number = 50,
  offset: number = 0,
): Promise<ConversationRow[]> {
  const rows = await ds.getRepository(Conversation).find({
    order: { id: "DESC" },
    take: limit,
    skip: offset,
  });
  return rows.map(toConversationRow);
}

export async function getConversation(
  ds: DataSource,
  id: number,
): Promise<ConversationRow | undefined> {
  const row = await ds.getRepository(Conversation).findOne({ where: { id } });
  return row ? toConversationRow(row) : undefined;
}

export async function countConversations(ds: DataSource): Promise<number> {
  return ds.getRepository(Conversation).count();
}
