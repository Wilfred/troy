import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openReminderDb } from "./datasource.js";
import { Reminder } from "./entities.js";
import { DueReminder, startReminderScheduler } from "./reminders.js";

function tmpDir(): string {
  const dir = join(
    tmpdir(),
    `troy-reminder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function insertReminder(
  dataDir: string,
  message: string,
  remindAt: Date,
): Promise<void> {
  const ds = await openReminderDb(dataDir);
  try {
    const repo = ds.getRepository(Reminder);
    await repo.save(
      repo.create({
        message,
        remind_at: remindAt.toISOString(),
        source: "cli",
      }),
    );
  } finally {
    await ds.destroy();
  }
}

describe("startReminderScheduler", () => {
  let dir = "";

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("fires overdue reminders immediately on startup", async () => {
    const past = new Date(Date.now() - 60_000);
    await insertReminder(dir, "overdue reminder", past);

    const fired: DueReminder[] = [];
    const timer = await new Promise<NodeJS.Timeout>((resolve) => {
      const t = startReminderScheduler(dir, (reminders) => {
        fired.push(...reminders);
        resolve(t);
      });
    });
    clearInterval(timer);

    assert.equal(fired.length, 1);
    assert.equal(fired[0].message, "overdue reminder");
  });

  it("does not fire future reminders on startup", async () => {
    const future = new Date(Date.now() + 60 * 60_000);
    await insertReminder(dir, "future reminder", future);

    const fired: DueReminder[] = [];
    const timer = startReminderScheduler(dir, (reminders) => {
      fired.push(...reminders);
    });
    // Wait long enough for the immediate poll to complete.
    await new Promise((resolve) => setTimeout(resolve, 200));
    clearInterval(timer);

    assert.equal(fired.length, 0);
  });
});
