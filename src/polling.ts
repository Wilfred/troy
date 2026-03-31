import { execFileSync } from "node:child_process";
import { log } from "./logger.js";

function getCurrentCommitHash(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMinutes(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

// Intervals in milliseconds: 1m, 1m, 1m, 2m, 4m, 8m, 16m, 32m, 64m
// Total: ~128 minutes (~2 hours), 9 checks.
const POLL_INTERVALS_MS = [
  60_000, 60_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000,
  3_840_000,
];

export async function handlePollForUpdateToolCall(): Promise<string> {
  const startHash = getCurrentCommitHash();
  if (startHash === null) {
    return "Error: not in a git repository, cannot poll for updates.";
  }

  log.info(`Polling for updates (current commit: ${startHash.slice(0, 12)})`);

  let elapsed = 0;
  for (const interval of POLL_INTERVALS_MS) {
    await sleep(interval);
    elapsed += interval;

    const currentHash = getCurrentCommitHash();
    if (currentHash === null) {
      log.warn("Lost access to git repository during polling");
      return `Polling stopped after ${formatMinutes(elapsed)}: lost access to git repository.`;
    }

    if (currentHash !== startHash) {
      log.info(
        `Update detected after ${formatMinutes(elapsed)}: ${startHash.slice(0, 12)} → ${currentHash.slice(0, 12)}`,
      );

      let commitMsg = "";
      try {
        commitMsg = execFileSync("git", ["log", "-1", "--format=%s"], {
          encoding: "utf-8",
        }).trim();
      } catch {
        // ignore
      }

      let result = `I've been updated after ${formatMinutes(elapsed)}! `;
      result += `Commit changed from ${startHash.slice(0, 12)} to ${currentHash.slice(0, 12)}.`;
      if (commitMsg) {
        result += ` Latest commit: "${commitMsg}".`;
      }
      result += ` Restart me to use the new version.`;
      return result;
    }

    log.debug(
      `Poll check after ${formatMinutes(elapsed)}: no change (next check in ${formatMinutes(POLL_INTERVALS_MS[POLL_INTERVALS_MS.indexOf(interval) + 1] ?? 0)})`,
    );
  }

  const totalMinutes = formatMinutes(elapsed);
  log.info(`Polling gave up after ${totalMinutes}`);
  return `I gave up waiting for an update after ${totalMinutes}. The commit is still ${startHash.slice(0, 12)}.`;
}

export const POLL_FOR_UPDATE_TOOL = {
  type: "function" as const,
  function: {
    name: "poll_for_update",
    description:
      "Poll for code updates by monitoring the git commit hash. Uses exponential backoff: checks every minute for the first 3 minutes, then doubles the interval (2m, 4m, 8m, 16m, 32m, 64m). Gives up after about 2 hours. Use this when the user wants to be notified when Troy has been updated.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
