import { createLogger, format, transports } from "winston";

const LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();

// eslint-disable-next-line @typescript-eslint/naming-convention
export const log = createLogger({
  level: LEVEL,
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(
      (info) =>
        `${info.timestamp as string} [${info.level as string}] ${info.message as string}`,
    ),
  ),
  transports: [
    new transports.Console({
      stderrLevels: ["debug", "info", "warn", "error"],
    }),
  ],
});
