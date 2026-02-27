import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Exchange = { user: string; assistant: string };

function historyPath(logDir: string): string {
  return join(logDir, "history.json");
}

function loadHistory(logDir: string): Exchange[] {
  const path = historyPath(logDir);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Exchange[];
  } catch {
    return [];
  }
}

function addExchange(logDir: string, user: string, assistant: string): void {
  const history = loadHistory(logDir);
  history.push({ user, assistant });
  writeFileSync(
    historyPath(logDir),
    JSON.stringify(history.slice(-2)),
    "utf-8",
  );
}

export { Exchange, loadHistory, addExchange };
