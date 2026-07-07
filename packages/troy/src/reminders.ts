import { LessThanOrEqual } from "typeorm";
import { parseStoredDate } from "@troy/shared";
import { Reminder } from "./entities.js";
import { openReminderDb } from "./datasource.js";
import { log } from "./logger.js";
import { LOCAL_TIMEZONE, parseLocalDateTime } from "./dates.js";

export interface DueReminder {
  id: number;
  message: string;
  remind_at: string;
  source: string;
}

async function findDueReminders(dataDir: string): Promise<DueReminder[]> {
  const ds = await openReminderDb(dataDir);
  try {
    const repo = ds.getRepository(Reminder);
    const now = new Date().toISOString();
    const rows = await repo.find({
      where: { delivered: 0, remind_at: LessThanOrEqual(now) },
      order: { remind_at: "ASC" },
    });

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

async function markDelivered(dataDir: string, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const ds = await openReminderDb(dataDir);
  try {
    await ds.getRepository(Reminder).update(ids, { delivered: 1 });
  } finally {
    await ds.destroy();
  }
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Poll for due reminders and hand them to `onDue` for delivery.
 *
 * A reminder is only marked `delivered` once `onDue` confirms it by
 * returning its id, so a crash or host reboot mid-delivery leaves the
 * reminder pending and it is retried on the next poll (at-least-once
 * delivery). `onDue` must therefore be idempotent enough to tolerate a
 * reminder being re-sent if the process dies after delivery but before the
 * database update commits. Transient failures (e.g. a Discord channel that
 * has not loaded yet right after restart) should be omitted from the
 * returned ids so they are retried; permanently undeliverable reminders
 * should be included so they are not retried forever.
 */
export function startReminderScheduler(
  dataDir: string,
  onDue: (reminders: DueReminder[]) => Promise<number[]>,
): NodeJS.Timeout {
  let inFlight = false;

  const tick = async (): Promise<void> => {
    // Skip overlapping ticks so a slow delivery can't double-send.
    if (inFlight) return;
    inFlight = true;
    try {
      const due = await findDueReminders(dataDir);
      if (due.length > 0) {
        const deliveredIds = await onDue(due);
        await markDelivered(dataDir, deliveredIds);
      }
    } catch (err: unknown) {
      log.error(
        `Reminder scheduler error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      inFlight = false;
    }
  };

  // Run an immediate check so a backlog accumulated while the process was
  // down (e.g. a host reboot) is delivered without waiting a full interval.
  void tick();

  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);

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
        "Set a reminder that will be delivered at the specified time. The reminder message will be shown to the user when the time arrives. " +
        "Always pick a sensible default time and create the reminder immediately — never ask the user follow-up questions to clarify the time.",
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
              "When to deliver the reminder, as an ISO 8601 datetime string (e.g. '2025-03-15T14:30:00'). Use 24-hour format. " +
              `Datetimes without a timezone designator are interpreted as ${LOCAL_TIMEZONE} wall-clock time, matching the "current time" in the system context. ` +
              "Never ask the user to clarify the time — always pick a sensible default and proceed. " +
              "For vague times of day, default to: morning = 09:00, noon/midday = 12:00, afternoon = 14:00, evening = 19:00, night = 21:00. " +
              "When the user gives an ambiguous time like 'at 9' without specifying AM/PM, choose the next upcoming occurrence — " +
              "if it is currently past 9am, use 9pm (21:00) today; if it is before 9am, use 9am today.",
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

  const remindAt = parseLocalDateTime(args.remind_at);
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

export interface ReminderRow {
  id: number;
  message: string;
  remind_at: Date;
  created_at: Date;
  source: string;
  delivered: boolean;
}

export async function listReminders(dataDir: string): Promise<ReminderRow[]> {
  const ds = await openReminderDb(dataDir);
  try {
    const rows = await ds.getRepository(Reminder).find({
      order: { remind_at: "ASC" },
    });
    return rows.map((r) => ({
      id: r.id,
      message: r.message,
      remind_at: parseStoredDate(r.remind_at),
      created_at: parseStoredDate(r.created_at),
      source: r.source,
      delivered: r.delivered === 1,
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
