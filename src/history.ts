import Database from "better-sqlite3";
import { WEATHER_TOOL } from "./weather.js";
import { SEARCH_TOOL, FETCH_TOOL } from "./search.js";
import { GITHUB_TOOLS } from "./github.js";

const UNTRUSTED_TOOL_NAMES = new Set(
  [WEATHER_TOOL, SEARCH_TOOL, FETCH_TOOL, ...GITHUB_TOOLS].map(
    (t) => t.function.name,
  ),
);

export const SEARCH_HISTORY_TOOL = {
  type: "function" as const,
  function: {
    name: "search_conversation_history",
    description:
      "Search past conversation history for a given string. Returns matching conversations with untrusted tool outputs redacted.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The text to search for in conversation history",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of results to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
};

function redactUntrustedToolOutputs(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let redacting = false;

  for (const line of lines) {
    const toolOutputMatch = line.match(/^Tool Output name=(\S+)/);
    if (toolOutputMatch) {
      const toolName = toolOutputMatch[1];
      if (UNTRUSTED_TOOL_NAMES.has(toolName)) {
        result.push(line);
        result.push("  [REDACTED]");
        redacting = true;
        continue;
      }
      redacting = false;
    } else if (redacting) {
      if (line.startsWith("  ")) {
        continue;
      }
      redacting = false;
    }

    result.push(line);
  }

  return result.join("\n");
}

export function handleSearchHistoryToolCall(
  argsJson: string,
  db: Database.Database,
): string {
  const args = JSON.parse(argsJson) as { query: string; limit?: number };
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);

  const rows = db
    .prepare(
      "SELECT id, prompt, response, content, created_at FROM conversations WHERE content LIKE ? ORDER BY id DESC LIMIT ?",
    )
    .all(`%${args.query}%`, limit) as Array<{
    id: number;
    prompt: string;
    response: string;
    content: string;
    created_at: string;
  }>;

  if (rows.length === 0) {
    return `No conversations found matching "${args.query}".`;
  }

  const results = rows.map((row) => {
    const redactedContent = redactUntrustedToolOutputs(row.content);
    return `--- C${row.id} (${row.created_at}) ---\n${redactedContent}`;
  });

  return `Found ${rows.length} conversation(s):\n\n${results.join("\n\n")}`;
}
