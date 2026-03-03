import { createLogger, format, transports } from "winston";
import { getNonSensitiveSettings } from "./settings.js";

export const log = createLogger({
  level: getNonSensitiveSettings().logLevel,
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

export function setLogLevel(level: string): void {
  log.level = level;
}
