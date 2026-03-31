import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { log } from "./logger.js";

interface RecurringTaskRow {
  id: number;
  name: string;
  prompt: string;
  schedule: string;
  enabled: number;
  last_run: string | null;
  created_at: string;
  source: string;
}

function openRecurringDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "recurring.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS recurring_tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      schedule   TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      last_run   TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      source     TEXT NOT NULL DEFAULT 'cli'
    )
  `);
  return db;
}

// Minimal 5-field cron matcher: minute hour day-of-month month day-of-week
// Supports: * (any), specific numbers, comma-separated lists, ranges (e.g. 1-5)
function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    const values: number[] = [];
    for (let i = min; i <= max; i++) {
      values.push(i);
    }
    return values;
  }

  const values: number[] = [];
  for (const part of field.split(",")) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
    } else {
      // Handle */N step syntax
      const stepMatch = part.match(/^\*\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[1], 10);
        for (let i = min; i <= max; i += step) {
          values.push(i);
        }
      } else {
        values.push(parseInt(part, 10));
      }
    }
  }
  return values;
}

export function matchesCron(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = date.getDay(); // 0=Sunday

  const minuteValues = parseCronField(fields[0], 0, 59);
  const hourValues = parseCronField(fields[1], 0, 23);
  const domValues = parseCronField(fields[2], 1, 31);
  const monthValues = parseCronField(fields[3], 1, 12);
  const dowValues = parseCronField(fields[4], 0, 6);

  return (
    minuteValues.includes(minute) &&
    hourValues.includes(hour) &&
    domValues.includes(dayOfMonth) &&
    monthValues.includes(month) &&
    dowValues.includes(dayOfWeek)
  );
}

export function validateCron(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return "Cron expression must have exactly 5 fields: minute hour day-of-month month day-of-week";
  }

  const FIELD_NAMES = [
    "minute",
    "hour",
    "day-of-month",
    "month",
    "day-of-week",
  ];
  const FIELD_RANGES: Array<[number, number]> = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];

  for (let i = 0; i < 5; i++) {
    const field = fields[i];
    if (field === "*") continue;

    for (const part of field.split(",")) {
      const rangeMatch = part.match(/^(\d+)-(\d+)$/);
      const stepMatch = part.match(/^\*\/(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (
          start < FIELD_RANGES[i][0] ||
          end > FIELD_RANGES[i][1] ||
          start > end
        ) {
          return `Invalid range ${part} for ${FIELD_NAMES[i]} (${FIELD_RANGES[i][0]}-${FIELD_RANGES[i][1]})`;
        }
      } else if (stepMatch) {
        const step = parseInt(stepMatch[1], 10);
        if (step < 1 || step > FIELD_RANGES[i][1]) {
          return `Invalid step ${part} for ${FIELD_NAMES[i]}`;
        }
      } else {
        const val = parseInt(part, 10);
        if (
          isNaN(val) ||
          val < FIELD_RANGES[i][0] ||
          val > FIELD_RANGES[i][1]
        ) {
          return `Invalid value ${part} for ${FIELD_NAMES[i]} (${FIELD_RANGES[i][0]}-${FIELD_RANGES[i][1]})`;
        }
      }
    }
  }

  return null;
}

export interface DueRecurringTask {
  id: number;
  name: string;
  prompt: string;
  source: string;
}

function checkDueRecurringTasks(dataDir: string): DueRecurringTask[] {
  const db = openRecurringDb(dataDir);
  const now = new Date();
  const rows = db
    .prepare(
      "SELECT id, name, prompt, schedule, last_run, source FROM recurring_tasks WHERE enabled = 1",
    )
    .all() as RecurringTaskRow[];

  const due: DueRecurringTask[] = [];
  for (const row of rows) {
    if (!matchesCron(row.schedule, now)) continue;

    // Avoid firing more than once per minute for the same task
    if (row.last_run) {
      const lastRun = new Date(row.last_run);
      const diffMs = now.getTime() - lastRun.getTime();
      if (diffMs < 60_000) continue;
    }

    due.push({
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      source: row.source,
    });
  }

  if (due.length > 0) {
    const ids = due.map((t) => t.id);
    const nowIso = now.toISOString();
    db.prepare(
      `UPDATE recurring_tasks SET last_run = ? WHERE id IN (${ids.map(() => "?").join(",")})`,
    ).run(nowIso, ...ids);
  }

  db.close();
  return due;
}

const POLL_INTERVAL_MS = 30_000;

export function startRecurringScheduler(
  dataDir: string,
  onDue: (tasks: DueRecurringTask[]) => void,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      const due = checkDueRecurringTasks(dataDir);
      if (due.length > 0) {
        onDue(due);
      }
    } catch (err) {
      log.error(
        `Recurring task scheduler error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, POLL_INTERVAL_MS);

  timer.unref();
  return timer;
}

export const RECURRING_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "create_recurring_task",
      description:
        "Create a recurring task that fires on a cron schedule. When it fires, the prompt is shown to the user. " +
        "Use a 5-field cron expression: minute hour day-of-month month day-of-week. " +
        "Examples: '0 9 * * 1' = every Monday at 9am, '0 7 * * *' = daily at 7am, '0 9 1 * *' = 1st of each month at 9am.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "A short descriptive name for the task (e.g. 'Weekly calendar summary')",
          },
          prompt: {
            type: "string",
            description:
              "The prompt or message to deliver when the task fires (e.g. 'Summarize my calendar for this week')",
          },
          schedule: {
            type: "string",
            description:
              "A 5-field cron expression: minute hour day-of-month month day-of-week. " +
              "Day-of-week: 0=Sunday, 1=Monday, ..., 6=Saturday. " +
              "Supports: * (any), specific numbers, comma-separated lists, ranges (1-5), steps (*/15).",
          },
        },
        required: ["name", "prompt", "schedule"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_recurring_tasks",
      description:
        "List all recurring tasks with their schedules, enabled status, and last run time.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_recurring_task",
      description:
        "Update an existing recurring task. Only the provided fields will be changed.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "The ID of the recurring task to update",
          },
          name: {
            type: "string",
            description: "New name for the task",
          },
          prompt: {
            type: "string",
            description: "New prompt for the task",
          },
          schedule: {
            type: "string",
            description: "New cron schedule expression",
          },
          enabled: {
            type: "boolean",
            description: "Enable or disable the task",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_recurring_task",
      description: "Delete a recurring task by its ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "number",
            description: "The ID of the recurring task to delete",
          },
        },
        required: ["id"],
      },
    },
  },
];

function describeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return expression;

  const [minute, hour, dom, month, dow] = fields;
  const DAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const MONTH_NAMES = [
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const time =
    minute !== "*" && hour !== "*"
      ? `at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
      : "";

  if (dom === "*" && month === "*" && dow === "*") {
    return time ? `Daily ${time}` : `Every minute`;
  }

  if (dom === "*" && month === "*" && dow !== "*") {
    const days = parseCronField(dow, 0, 6).map((d) => DAY_NAMES[d]);
    return `Every ${days.join(", ")} ${time}`.trim();
  }

  if (dow === "*" && month === "*" && dom !== "*") {
    return `Day ${dom} of each month ${time}`.trim();
  }

  if (dow === "*" && dom !== "*" && month !== "*") {
    const months = parseCronField(month, 1, 12).map((m) => MONTH_NAMES[m]);
    return `${months.join(", ")} ${dom} ${time}`.trim();
  }

  return `${expression} ${time}`.trim();
}

function handleCreateRecurringTask(
  dataDir: string,
  argsJson: string,
  source: string,
): string {
  const args = JSON.parse(argsJson) as {
    name: string;
    prompt: string;
    schedule: string;
  };

  const validationError = validateCron(args.schedule);
  if (validationError) {
    return `Error: ${validationError}`;
  }

  const db = openRecurringDb(dataDir);
  const result = db
    .prepare(
      "INSERT INTO recurring_tasks (name, prompt, schedule, source) VALUES (?, ?, ?, ?)",
    )
    .run(args.name, args.prompt, args.schedule, source);
  db.close();

  const desc = describeCron(args.schedule);
  log.info(
    `Created recurring task #${result.lastInsertRowid}: "${args.name}" (${desc})`,
  );
  return `Recurring task #${result.lastInsertRowid} created: "${args.name}" — ${desc}`;
}

function handleListRecurringTasks(dataDir: string): string {
  const db = openRecurringDb(dataDir);
  const rows = db
    .prepare(
      "SELECT id, name, prompt, schedule, enabled, last_run, created_at FROM recurring_tasks ORDER BY id",
    )
    .all() as RecurringTaskRow[];
  db.close();

  if (rows.length === 0) {
    return "No recurring tasks.";
  }

  const lines = rows.map((r) => {
    const status = r.enabled ? "enabled" : "disabled";
    const desc = describeCron(r.schedule);
    const lastRun = r.last_run ? ` (last run: ${r.last_run})` : "";
    return `#${r.id}: "${r.name}" [${status}] — ${desc}${lastRun}\n  Prompt: ${r.prompt}`;
  });
  return `Recurring tasks:\n${lines.join("\n")}`;
}

function handleUpdateRecurringTask(dataDir: string, argsJson: string): string {
  const args = JSON.parse(argsJson) as {
    id: number;
    name?: string;
    prompt?: string;
    schedule?: string;
    enabled?: boolean;
  };

  if (args.schedule) {
    const validationError = validateCron(args.schedule);
    if (validationError) {
      return `Error: ${validationError}`;
    }
  }

  const db = openRecurringDb(dataDir);

  const existing = db
    .prepare("SELECT id FROM recurring_tasks WHERE id = ?")
    .get(args.id) as RecurringTaskRow | undefined;
  if (!existing) {
    db.close();
    return `No recurring task found with ID #${args.id}.`;
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (args.name !== undefined) {
    updates.push("name = ?");
    values.push(args.name);
  }
  if (args.prompt !== undefined) {
    updates.push("prompt = ?");
    values.push(args.prompt);
  }
  if (args.schedule !== undefined) {
    updates.push("schedule = ?");
    values.push(args.schedule);
  }
  if (args.enabled !== undefined) {
    updates.push("enabled = ?");
    values.push(args.enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    db.close();
    return "No fields to update.";
  }

  values.push(args.id);
  db.prepare(
    `UPDATE recurring_tasks SET ${updates.join(", ")} WHERE id = ?`,
  ).run(...values);
  db.close();

  log.info(`Updated recurring task #${args.id}`);
  return `Recurring task #${args.id} updated.`;
}

function handleDeleteRecurringTask(dataDir: string, argsJson: string): string {
  const args = JSON.parse(argsJson) as { id: number };
  const db = openRecurringDb(dataDir);
  const result = db
    .prepare("DELETE FROM recurring_tasks WHERE id = ?")
    .run(args.id);
  db.close();

  if (result.changes === 0) {
    return `No recurring task found with ID #${args.id}.`;
  }

  log.info(`Deleted recurring task #${args.id}`);
  return `Recurring task #${args.id} deleted.`;
}

export function handleRecurringToolCall(
  name: string,
  argsJson: string,
  dataDir: string,
  source: string,
): string | null {
  if (name === "create_recurring_task") {
    return handleCreateRecurringTask(dataDir, argsJson, source);
  }
  if (name === "list_recurring_tasks") {
    return handleListRecurringTasks(dataDir);
  }
  if (name === "update_recurring_task") {
    return handleUpdateRecurringTask(dataDir, argsJson);
  }
  if (name === "delete_recurring_task") {
    return handleDeleteRecurringTask(dataDir, argsJson);
  }
  return null;
}
