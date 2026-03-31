import { execSync } from "node:child_process";
import { log } from "./logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

interface CommandResult {
  exitCode: number;
  output: string;
}

function runCommand(command: string): CommandResult {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { exitCode: 0, output };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    const output = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
    return { exitCode: e.status ?? 1, output };
  }
}

// Intervals in milliseconds: 1m, 1m, 1m, 2m, 4m, 8m, 16m, 32m, 64m
// Total: ~128 minutes (~2 hours), 9 checks.
const POLL_INTERVALS_MS = [
  60_000, 60_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000,
  3_840_000,
];

export async function handlePollToolCall(argsJson: string): Promise<string> {
  const args = JSON.parse(argsJson) as { command: string };
  const { command } = args;

  const initial = runCommand(command);
  log.info(
    `Polling started: "${command}" (initial exit code: ${initial.exitCode})`,
  );

  let elapsed = 0;
  for (const interval of POLL_INTERVALS_MS) {
    await sleep(interval);
    elapsed += interval;

    const current = runCommand(command);
    const changed =
      current.exitCode !== initial.exitCode ||
      current.output !== initial.output;

    if (changed) {
      log.info(`Poll condition changed after ${formatDuration(elapsed)}`);
      let result = `Polling "${command}" detected a change after ${formatDuration(elapsed)}.\n`;
      result += `Exit code: ${initial.exitCode} → ${current.exitCode}\n`;
      if (current.output !== initial.output) {
        result += `Output:\n${current.output}`;
      }
      return result;
    }

    log.debug(`Poll check after ${formatDuration(elapsed)}: no change`);
  }

  log.info(`Polling gave up after ${formatDuration(elapsed)}`);
  return `I gave up polling "${command}" after ${formatDuration(elapsed)}. No change detected.`;
}

export const POLL_TOOL = {
  type: "function" as const,
  function: {
    name: "poll",
    description:
      "Run a shell command repeatedly until its output or exit code changes. Uses exponential backoff: checks every minute for the first 3 minutes, then doubles the interval (2m, 4m, 8m, 16m, 32m, 64m). Gives up after about 2 hours. Use this when the user wants to be notified when something changes, e.g. when a deployment finishes, a service comes back up, or a build completes.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The shell command to run on each poll. The tool detects a change when the exit code or stdout changes from the initial run.",
        },
      },
      required: ["command"],
    },
  },
};
