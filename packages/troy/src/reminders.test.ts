import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DueReminder,
  handleReminderToolCall,
  listReminders,
  startReminderScheduler,
} from "./reminders.js";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "troy-reminder-test-"));
}

async function setPastReminder(dataDir: string): Promise<void> {
  // A timestamp safely in the past so it is immediately due.
  await handleReminderToolCall(
    "set_reminder",
    JSON.stringify({ message: "ping", remind_at: "2000-01-01T00:00:00" }),
    dataDir,
    "cli",
  );
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor timed out");
}

describe("startReminderScheduler", () => {
  it("only marks a reminder delivered once onDue confirms it", async () => {
    const dataDir = makeDataDir();
    await setPastReminder(dataDir);

    let calls = 0;
    const timer = startReminderScheduler(dataDir, (): Promise<number[]> => {
      calls += 1;
      // Simulate a transient delivery failure on the first pass by
      // confirming nothing.
      return Promise.resolve([]);
    });

    try {
      await waitFor(() => Promise.resolve(calls >= 1));
      // The reminder was handed to onDue but not confirmed, so it must
      // remain pending and retryable rather than being silently lost.
      const rows = await listReminders(dataDir);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].delivered, false);
    } finally {
      clearInterval(timer);
    }
  });

  it("marks a reminder delivered when onDue returns its id", async () => {
    const dataDir = makeDataDir();
    await setPastReminder(dataDir);

    const timer = startReminderScheduler(
      dataDir,
      (due: DueReminder[]): Promise<number[]> =>
        Promise.resolve(due.map((r) => r.id)),
    );

    try {
      await waitFor(async () => {
        const rows = await listReminders(dataDir);
        return rows.length === 1 && rows[0].delivered;
      });
    } finally {
      clearInterval(timer);
    }
  });
});
