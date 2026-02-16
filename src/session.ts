import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";

async function runSession(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return "Error: ANTHROPIC_API_KEY environment variable is not set. This is required to trigger a Claude Code session.";
  }

  const q = query({
    prompt,
    options: {
      model: "claude-sonnet-4-5-20250929",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      persistSession: false,
    },
  });

  let resultText = "";
  for await (const msg of q) {
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        const success = msg as SDKResultSuccess;
        resultText = success.result;
      } else {
        resultText = `Session ended with status: ${msg.subtype}`;
      }
    }
  }

  return resultText || "Session completed with no output.";
}

export const sessionTool = {
  type: "function" as const,
  function: {
    name: "trigger_session",
    description:
      "Trigger a new Claude Code session to perform a coding task. Use this to delegate complex coding work to a Claude Code agent that can read files, write code, and run commands.",
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
