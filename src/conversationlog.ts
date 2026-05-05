import { DataSource, MoreThanOrEqual } from "typeorm";
import { Conversation } from "./entities.js";
import { openConversationDb } from "./datasource.js";

export type StoredToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type StoredMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string | null;
      toolCalls?: StoredToolCall[];
    }
  | { role: "tool"; content: string; toolCallId: string };

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

type Exchange = {
  user: string;
  assistant: string;
  messages: StoredMessage[];
};

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
  row: ConversationRow,
): ConversationEntry[] | null {
  if (!row.entries) return null;
  return JSON.parse(row.entries) as ConversationEntry[];
}

export function openDb(logDir: string): Promise<DataSource> {
  return openConversationDb(logDir);
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
  const content = formatConversationLog(entries);
  const repo = ds.getRepository(Conversation);
  const row = repo.create({
    source: source ?? "cli",
    prompt,
    response,
    content,
    entries: JSON.stringify(entries),
    messages: messages ? JSON.stringify(messages) : null,
    total_duration_ms: totalDurationMs ?? null,
  });
  await repo.save(row);
  return row.id;
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
  created_at: string;
};

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
  return ds.getRepository(Conversation).find({
    order: { id: "DESC" },
    take: limit,
    skip: offset,
  });
}

export async function getConversation(
  ds: DataSource,
  id: number,
): Promise<ConversationRow | undefined> {
  const row = await ds.getRepository(Conversation).findOne({ where: { id } });
  return row ?? undefined;
}

export async function countConversations(ds: DataSource): Promise<number> {
  return ds.getRepository(Conversation).count();
}

function sqliteNow(offsetSeconds: number = 0): string {
  const d = new Date(Date.now() + offsetSeconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

function parseStoredMessages(raw: string | null): StoredMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as StoredMessage[];
    }
  } catch {
    // ignore — fall through to empty
  }
  return [];
}

export async function loadRecentHistory(
  ds: DataSource,
  source?: string,
): Promise<Exchange[]> {
  const repo = ds.getRepository(Conversation);
  const src = source ?? "cli";

  // Always include the 3 most recent exchanges.
  const recentRows = await repo.find({
    where: { source: src },
    order: { id: "DESC" },
    take: 3,
    select: ["id", "prompt", "response", "messages"],
  });

  // Also include all exchanges from the last hour.
  const oneHourAgo = sqliteNow(-3600);
  const lastHourRows = await repo.find({
    where: { source: src, created_at: MoreThanOrEqual(oneHourAgo) },
    order: { id: "ASC" },
    select: ["id", "prompt", "response", "messages"],
  });
  // Merge and deduplicate by id, keeping chronological order.
  const seen = new Set<number>();
  const merged: Array<{
    id: number;
    prompt: string;
    response: string;
    messages: string | null;
  }> = [];

  for (const row of lastHourRows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push({
        id: row.id,
        prompt: row.prompt,
        response: row.response,
        messages: row.messages,
      });
    }
  }

  const recentAsc = [...recentRows].reverse();
  for (const row of recentAsc) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push({
        id: row.id,
        prompt: row.prompt,
        response: row.response,
        messages: row.messages,
      });
    }
  }

  merged.sort((a, b) => a.id - b.id);

  return merged.map((row) => ({
    user: row.prompt,
    assistant: row.response,
    messages: parseStoredMessages(row.messages),
  }));
}
