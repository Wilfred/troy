import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { log } from "./logger.js";

interface ReminderRow {
  id: number;
  message: string;
  remind_at: string;
  created_at: string;
  delivered: number;
  source: string;
}

function openRemindersDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "reminders.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message    TEXT NOT NULL,
      remind_at  TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      delivered  INTEGER NOT NULL DEFAULT 0,
      source     TEXT NOT NULL DEFAULT 'cli'
    )
  `);
  return db;
}

export interface DueReminder {
  id: number;
  message: string;
  remind_at: string;
  source: string;
}

function checkDueReminders(dataDir: string): DueReminder[] {
  const db = openRemindersDb(dataDir);
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      "SELECT id, message, remind_at, source FROM reminders WHERE delivered = 0 AND remind_at <= ? ORDER BY remind_at",
    )
    .all(now) as ReminderRow[];

  if (rows.length === 0) {
    db.close();
    return [];
  }

  const ids = rows.map((r) => r.id);
  db.prepare(
    `UPDATE reminders SET delivered = 1 WHERE id IN (${ids.map(() => "?").join(",")})`,
  ).run(...ids);
  db.close();

  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    remind_at: r.remind_at,
    source: r.source,
  }));
}

const POLL_INTERVAL_MS = 30_000;

export function startReminderScheduler(
  dataDir: string,
  onDue: (reminders: DueReminder[]) => void,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      const due = checkDueReminders(dataDir);
      if (due.length > 0) {
        onDue(due);
      }
    } catch (err) {
      log.error(
        `Reminder scheduler error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, POLL_INTERVAL_MS);

  // Don't keep the process alive just for the scheduler
  timer.unref();
  return timer;
}

export const REMINDER_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "set_reminder",
      description:
        "Set a reminder that will be delivered at the specified time. The reminder message will be shown to the user when the time arrives.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The reminder message to deliver",
          },
          remind_at: {
            type: "string",
            description:
              "When to deliver the reminder, as an ISO 8601 datetime string (e.g. '2025-03-15T14:30:00'). " +
              "When the user gives an ambiguous time like 'at 9' without specifying AM/PM, " +
              "choose the next upcoming occurrence — if it is currently past 9am, use 9pm (21:00) today; " +
              "if it is before 9am, use 9am today. Use 24-hour format.",
          },
        },
        required: ["message", "remind_at"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_reminders",
      description:
        "List all pending (undelivered) reminders. Use this when the user asks about their upcoming reminders.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_reminder",
      description: "Delete a reminder by its ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "The ID of the reminder to delete",
          },
        },
        required: ["id"],
      },
    },
  },
];

function handleSetReminder(
  dataDir: string,
  argsJson: string,
  source: string,
): string {
  const args = JSON.parse(argsJson) as {
    message: string;
    remind_at: string;
  };

  const remindAt = new Date(args.remind_at);
  if (isNaN(remindAt.getTime())) {
    return "Error: invalid remind_at datetime. Use ISO 8601 format (e.g. '2025-03-15T14:30:00').";
  }

  const db = openRemindersDb(dataDir);
  const result = db
    .prepare(
      "INSERT INTO reminders (message, remind_at, source) VALUES (?, ?, ?)",
    )
    .run(args.message, remindAt.toISOString(), source);
  db.close();

  log.info(
    `Created reminder #${result.lastInsertRowid} for ${remindAt.toISOString()}`,
  );
  return `Reminder #${result.lastInsertRowid} set for ${remindAt.toISOString()}: "${args.message}"`;
}

function handleListReminders(dataDir: string): string {
  const db = openRemindersDb(dataDir);
  const rows = db
    .prepare(
      "SELECT id, message, remind_at, created_at FROM reminders WHERE delivered = 0 ORDER BY remind_at",
    )
    .all() as ReminderRow[];
  db.close();

  if (rows.length === 0) {
    return "No pending reminders.";
  }

  const lines = rows.map(
    (r) =>
      `#${r.id}: "${r.message}" — due ${r.remind_at} (created ${r.created_at})`,
  );
  return `Pending reminders:\n${lines.join("\n")}`;
}

function handleDeleteReminder(dataDir: string, argsJson: string): string {
  const args = JSON.parse(argsJson) as { id: number };
  const db = openRemindersDb(dataDir);
  const result = db.prepare("DELETE FROM reminders WHERE id = ?").run(args.id);
  db.close();

  if (result.changes === 0) {
    return `No reminder found with ID #${args.id}.`;
  }

  log.info(`Deleted reminder #${args.id}`);
  return `Reminder #${args.id} deleted.`;
}

interface PendingReminder {
  id: number;
  message: string;
  remind_at: string;
  created_at: string;
  source: string;
}

export function listPendingReminders(dataDir: string): PendingReminder[] {
  const db = openRemindersDb(dataDir);
  const rows = db
    .prepare(
      "SELECT id, message, remind_at, created_at, source FROM reminders WHERE delivered = 0 ORDER BY remind_at",
    )
    .all() as PendingReminder[];
  db.close();
  return rows;
}

export function handleReminderToolCall(
  name: string,
  argsJson: string,
  dataDir: string,
  source: string,
): string | null {
  if (name === "set_reminder") {
    return handleSetReminder(dataDir, argsJson, source);
  }
  if (name === "list_reminders") {
    return handleListReminders(dataDir);
  }
  if (name === "delete_reminder") {
    return handleDeleteReminder(dataDir, argsJson);
  }
  return null;
}
