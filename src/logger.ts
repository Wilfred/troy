const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

type Level = keyof typeof LEVELS;

function getLogLevel(): Level {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (env in LEVELS) return env as Level;
  return "info";
}

function writeLog(level: Level, message: string): void {
  if (LEVELS[level] < LEVELS[getLogLevel()]) return;
  process.stderr.write(`[${level.toUpperCase()}] ${message}\n`);
}

export const log = {
  debug: (message: string): void => writeLog("debug", message),
  info: (message: string): void => writeLog("info", message),
  warn: (message: string): void => writeLog("warn", message),
  error: (message: string): void => writeLog("error", message),
};
