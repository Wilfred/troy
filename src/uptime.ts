import { execFileSync } from "node:child_process";
import { log } from "./logger.js";

const processStartTime = new Date();

function formatRelative(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatAbsolute(date: Date): string {
  return date.toISOString();
}

function getMachineBootTime(): Date {
  const uptimeSeconds = parseFloat(
    execFileSync("cat", ["/proc/uptime"], { encoding: "utf-8" }).split(" ")[0],
  );
  return new Date(Date.now() - uptimeSeconds * 1000);
}

function getLatestCommit(): {
  date: Date;
  message: string;
  hash: string;
} | null {
  try {
    const output = execFileSync("git", ["log", "-1", "--format=%H%n%aI%n%s"], {
      encoding: "utf-8",
    }).trim();
    const [hash, dateStr, ...messageParts] = output.split("\n");
    return {
      hash: hash.slice(0, 12),
      date: new Date(dateStr),
      message: messageParts.join("\n"),
    };
  } catch {
    return null;
  }
}

export function handleUptimeToolCall(): string {
  log.info("Fetching uptime info");

  const now = Date.now();
  const processUptimeMs = now - processStartTime.getTime();

  let result = "## Process Uptime\n";
  result += `- Started: ${formatAbsolute(processStartTime)}\n`;
  result += `- Uptime: ${formatRelative(processUptimeMs)}\n`;

  try {
    const bootTime = getMachineBootTime();
    const machineUptimeMs = now - bootTime.getTime();
    result += `\n## Machine Uptime\n`;
    result += `- Booted: ${formatAbsolute(bootTime)}\n`;
    result += `- Uptime: ${formatRelative(machineUptimeMs)}\n`;
  } catch {
    result += `\n## Machine Uptime\n- Unavailable\n`;
  }

  const commit = getLatestCommit();
  if (commit) {
    const commitAgeMs = now - commit.date.getTime();
    result += `\n## Latest Commit\n`;
    result += `- Hash: ${commit.hash}\n`;
    result += `- Date: ${formatAbsolute(commit.date)}\n`;
    result += `- Age: ${formatRelative(commitAgeMs)}\n`;
    result += `- Message: ${commit.message}\n`;
  } else {
    result += `\n## Latest Commit\n- Not in a git repository\n`;
  }

  return result;
}

export const uptimeTool = {
  type: "function" as const,
  function: {
    name: "get_uptime",
    description:
      "Get the process uptime, machine uptime, and the age and message of the most recent git commit. Returns both relative and absolute times.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};
