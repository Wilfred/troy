import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

export type ConversationEntry =
  | { kind: "system"; content: string }
  | { kind: "history"; role: "user" | "assistant"; content: string }
  | { kind: "prompt"; content: string }
  | { kind: "response"; content: string }
  | { kind: "tool_input"; name: string; content: string }
  | { kind: "tool_output"; name: string; content: string; duration_ms: number };

type Exchange = { user: string; assistant: string };

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
    case "history":
      return `History ${entry.role}:\n${indentBlock(entry.content)}`;
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

export function buildContextEntries(
  systemPrompt: string,
  history: Exchange[],
): ConversationEntry[] {
  const entries: ConversationEntry[] = [
    { kind: "system", content: systemPrompt },
  ];
  for (const exchange of history) {
    entries.push({ kind: "history", role: "user", content: exchange.user });
    entries.push({
      kind: "history",
      role: "assistant",
      content: exchange.assistant,
    });
  }
  return entries;
}

export function formatConversationLog(entries: ConversationEntry[]): string {
  return entries.map(formatEntry).join("\n\n") + "\n";
}

export function openDb(logDir: string): Database.Database {
  mkdirSync(logDir, { recursive: true });
  const db = new Database(join(logDir, "conversations.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'cli',
      prompt   TEXT NOT NULL,
      response TEXT NOT NULL,
      content  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Migration: add created_at to tables created before this column existed.
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{
    name: string;
  }>;
  if (!cols.some((c) => c.name === "created_at")) {
    db.exec("ALTER TABLE conversations ADD COLUMN created_at TEXT DEFAULT ''");
    db.exec(
      "UPDATE conversations SET created_at = datetime('now') WHERE created_at = ''",
    );
  }
  return db;
}

export function writeConversationLog(
  db: Database.Database,
  entries: ConversationEntry[],
  source?: string,
): number {
  const promptEntry = entries.find((e) => e.kind === "prompt");
  const responseEntries = entries.filter((e) => e.kind === "response");
  const lastResponse = responseEntries[responseEntries.length - 1];
  const prompt = promptEntry?.content ?? "";
  const response = lastResponse?.content ?? "";
  const content = formatConversationLog(entries);
  const result = db
    .prepare(
      "INSERT INTO conversations (source, prompt, response, content) VALUES (?, ?, ?, ?)",
    )
    .run(source ?? "cli", prompt, response, content);
  return Number(result.lastInsertRowid);
}

export type ConversationRow = {
  id: number;
  source: string;
  prompt: string;
  response: string;
  content: string;
  created_at: string;
};

export function listConversations(
  db: Database.Database,
  limit: number = 50,
  offset: number = 0,
): ConversationRow[] {
  return db
    .prepare(
      "SELECT id, source, prompt, response, content, created_at FROM conversations ORDER BY id DESC LIMIT ? OFFSET ?",
    )
    .all(limit, offset) as ConversationRow[];
}

export function getConversation(
  db: Database.Database,
  id: number,
): ConversationRow | undefined {
  return db
    .prepare(
      "SELECT id, source, prompt, response, content, created_at FROM conversations WHERE id = ?",
    )
    .get(id) as ConversationRow | undefined;
}

export function countConversations(db: Database.Database): number {
  const row = db
    .prepare("SELECT COUNT(*) as count FROM conversations")
    .get() as { count: number };
  return row.count;
}

export function loadRecentHistory(
  db: Database.Database,
  source?: string,
): Exchange[] {
  // Always include the 3 most recent exchanges.
  const recentRows = db
    .prepare(
      "SELECT id, prompt, response FROM conversations WHERE source = ? ORDER BY id DESC LIMIT 3",
    )
    .all(source ?? "cli") as Array<{
    id: number;
    prompt: string;
    response: string;
  }>;

  // Also include all exchanges from the last hour.
  const lastHourRows = db
    .prepare(
      "SELECT id, prompt, response FROM conversations WHERE source = ? AND created_at >= datetime('now', '-1 hour') ORDER BY id ASC",
    )
    .all(source ?? "cli") as Array<{
    id: number;
    prompt: string;
    response: string;
  }>;

  // Merge and deduplicate by id, keeping chronological order.
  const seen = new Set<number>();
  const merged: Array<{ id: number; prompt: string; response: string }> = [];

  // Add last-hour rows first (already in ASC order).
  for (const row of lastHourRows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }

  // Add recent rows that weren't already included (reverse to get ASC order).
  for (const row of recentRows.reverse()) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }

  // Sort by id to ensure chronological order.
  merged.sort((a, b) => a.id - b.id);

  return merged.map((row) => ({ user: row.prompt, assistant: row.response }));
}
