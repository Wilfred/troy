import { DataSource, EntitySchema } from "typeorm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface RequestRow {
  id: number;
  timestamp: string;
  model: string;
  command: string;
  prompt: string;
  toolsUsed: string | null;
  response: string;
  durationMs: number;
}

const RequestEntity = new EntitySchema<RequestRow>({
  name: "request",
  columns: {
    id: {
      type: "integer",
      primary: true,
      generated: "increment",
    },
    timestamp: {
      type: "text",
    },
    model: {
      type: "text",
    },
    command: {
      type: "text",
    },
    prompt: {
      type: "text",
    },
    toolsUsed: {
      name: "tools_used",
      type: "text",
      nullable: true,
    },
    response: {
      type: "text",
    },
    durationMs: {
      name: "duration_ms",
      type: "integer",
    },
  },
});

async function initDb(dbPath: string): Promise<DataSource> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const dataSource = new DataSource({
    type: "better-sqlite3",
    database: dbPath,
    entities: [RequestEntity],
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();
  return dataSource;
}

async function logRequest(
  dataSource: DataSource,
  row: {
    timestamp: string;
    model: string;
    command: string;
    prompt: string;
    toolsUsed: string[];
    response: string;
    durationMs: number;
  },
): Promise<number> {
  const repo = dataSource.getRepository<RequestRow>("request");
  const result = await repo.insert({
    timestamp: row.timestamp,
    model: row.model,
    command: row.command,
    prompt: row.prompt,
    toolsUsed: row.toolsUsed.length > 0 ? JSON.stringify(row.toolsUsed) : null,
    response: row.response,
    durationMs: row.durationMs,
  });
  return Number(result.identifiers[0].id);
}

async function getRequest(
  dataSource: DataSource,
  id: number,
): Promise<RequestRow | null> {
  const repo = dataSource.getRepository<RequestRow>("request");
  return repo.findOneBy({ id });
}

export { initDb, logRequest, getRequest };
