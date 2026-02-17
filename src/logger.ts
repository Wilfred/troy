import { createLogger, format, transports } from "winston";

const level = (process.env.LOG_LEVEL ?? "info").toLowerCase();

export const log = createLogger({
  level,
  format: format.combine(
    format.timestamp(),
    format.printf(
      (info) =>
        `${info.timestamp as string} [${(info.level as string).toUpperCase()}] ${info.message as string}`,
    ),
  ),
  transports: [
    new transports.Console({
      stderrLevels: ["debug", "info", "warn", "error"],
    }),
  ],
});
