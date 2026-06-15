import "reflect-metadata";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { Reminder } from "./entities.js";

export async function openReminderDb(dataDir: string): Promise<DataSource> {
  mkdirSync(dataDir, { recursive: true });
  const ds = new DataSource({
    type: "better-sqlite3",
    database: join(dataDir, "reminders.db"),
    entities: [Reminder],
    synchronize: true,
  });
  await ds.initialize();
  return ds;
}
