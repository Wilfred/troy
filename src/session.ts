import { execFile } from "node:child_process";

function runSession(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "claude",
      ["-p", "--remote", "--output-format", "json", prompt],
      { timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve(
            `Error triggering session: ${stderr || error.message}`.trim(),
          );
          return;
        }
        resolve(stdout.trim() || "Session triggered (no output returned).");
      },
    );
  });
}

export const sessionTool = {
  type: "function" as const,
  function: {
    name: "trigger_session",
    description:
      "Trigger a new remote Claude Code session on claude.ai/code to perform a coding task. The session runs asynchronously in the cloud. Requires the claude CLI to be installed and authenticated.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The task or prompt for the Claude Code session, e.g. 'Fix the failing tests in src/utils.ts'",
        },
      },
      required: ["prompt"],
    },
  },
};

export async function handleSessionToolCall(argsJson: string): Promise<string> {
  const args = JSON.parse(argsJson) as { prompt: string };
  return await runSession(args.prompt);
}
