import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DataSource, MoreThanOrEqual } from "typeorm";
import { Conversation } from "./conversation.js";
import { Exchange, StoredMessage } from "./history.js";

export async function openConversationDb(dataDir: string): Promise<DataSource> {
  mkdirSync(dataDir, { recursive: true });
  const ds = new DataSource({
    type: "better-sqlite3",
    database: join(dataDir, "conversations.db"),
    entities: [Conversation],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}

export type NewExchange = {
  source?: string;
  prompt: string;
  response: string;
  content?: string;
  entries?: string | null;
  messages?: StoredMessage[] | null;
  totalDurationMs?: number | null;
};

/** Persist a single exchange and return its auto-incrementing id. */
export async function appendExchange(
  ds: DataSource,
  exchange: NewExchange,
): Promise<number> {
  const repo = ds.getRepository(Conversation);
  const row = repo.create({
    source: exchange.source ?? "cli",
    prompt: exchange.prompt,
    response: exchange.response,
    content: exchange.content ?? "",
    entries: exchange.entries ?? null,
    messages: exchange.messages ? JSON.stringify(exchange.messages) : null,
    total_duration_ms: exchange.totalDurationMs ?? null,
  });
  await repo.save(row);
  return row.id;
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

/**
 * Load recent conversation history for a source: always the 3 most recent
 * exchanges, plus every exchange from the last hour, merged and ordered
 * chronologically.
 */
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
