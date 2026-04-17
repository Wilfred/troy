import { LessThanOrEqual } from "typeorm";
import { Reminder } from "./entities.js";
import { openReminderDb } from "./datasource.js";
import { log } from "./logger.js";

export interface DueReminder {
  id: number;
  message: string;
  remind_at: string;
  source: string;
}

async function checkDueReminders(dataDir: string): Promise<DueReminder[]> {
  const ds = await openReminderDb(dataDir);
  try {
    const repo = ds.getRepository(Reminder);
    const now = new Date().toISOString();
    const rows = await repo.find({
      where: { delivered: 0, remind_at: LessThanOrEqual(now) },
      order: { remind_at: "ASC" },
    });

    if (rows.length === 0) {
      return [];
    }

    await repo.update(
      rows.map((r) => r.id),
      { delivered: 1 },
    );

    return rows.map((r) => ({
      id: r.id,
      message: r.message,
      remind_at: r.remind_at,
      source: r.source,
    }));
  } finally {
    await ds.destroy();
  }
}

const POLL_INTERVAL_MS = 30_000;

export function startReminderScheduler(
  dataDir: string,
  onDue: (reminders: DueReminder[]) => void,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    checkDueReminders(dataDir)
      .then((due) => {
        if (due.length > 0) onDue(due);
      })
      .catch((err: unknown) => {
        log.error(
          `Reminder scheduler error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
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

async function handleSetReminder(
  dataDir: string,
  argsJson: string,
  source: string,
): Promise<string> {
  const args = JSON.parse(argsJson) as {
    message: string;
    remind_at: string;
  };

  const remindAt = new Date(args.remind_at);
  if (isNaN(remindAt.getTime())) {
    return "Error: invalid remind_at datetime. Use ISO 8601 format (e.g. '2025-03-15T14:30:00').";
  }

  const ds = await openReminderDb(dataDir);
  try {
    const repo = ds.getRepository(Reminder);
    const reminder = repo.create({
      message: args.message,
      remind_at: remindAt.toISOString(),
      source,
    });
    await repo.save(reminder);
    log.info(`Created reminder #${reminder.id} for ${remindAt.toISOString()}`);
    return `Reminder #${reminder.id} set for ${remindAt.toISOString()}: "${args.message}"`;
  } finally {
    await ds.destroy();
  }
}

async function handleListReminders(dataDir: string): Promise<string> {
  const ds = await openReminderDb(dataDir);
  try {
    const rows = await ds.getRepository(Reminder).find({
      where: { delivered: 0 },
      order: { remind_at: "ASC" },
    });

    if (rows.length === 0) {
      return "No pending reminders.";
    }

    const lines = rows.map(
      (r) =>
        `#${r.id}: "${r.message}" — due ${r.remind_at} (created ${r.created_at})`,
    );
    return `Pending reminders:\n${lines.join("\n")}`;
  } finally {
    await ds.destroy();
  }
}

async function handleDeleteReminder(
  dataDir: string,
  argsJson: string,
): Promise<string> {
  const args = JSON.parse(argsJson) as { id: number };
  const ds = await openReminderDb(dataDir);
  try {
    const result = await ds.getRepository(Reminder).delete({ id: args.id });
    if (!result.affected) {
      return `No reminder found with ID #${args.id}.`;
    }
    log.info(`Deleted reminder #${args.id}`);
    return `Reminder #${args.id} deleted.`;
  } finally {
    await ds.destroy();
  }
}

interface PendingReminder {
  id: number;
  message: string;
  remind_at: string;
  created_at: string;
  source: string;
}

export async function listPendingReminders(
  dataDir: string,
): Promise<PendingReminder[]> {
  const ds = await openReminderDb(dataDir);
  try {
    const rows = await ds.getRepository(Reminder).find({
      where: { delivered: 0 },
      order: { remind_at: "ASC" },
    });
    return rows.map((r) => ({
      id: r.id,
      message: r.message,
      remind_at: r.remind_at,
      created_at: r.created_at,
      source: r.source,
    }));
  } finally {
    await ds.destroy();
  }
}

export async function handleReminderToolCall(
  name: string,
  argsJson: string,
  dataDir: string,
  source: string,
): Promise<string | null> {
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
