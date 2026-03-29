import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { WEATHER_TOOL, handleWeatherToolCall } from "./weather.js";
import { CALENDAR_TOOLS, handleCalendarToolCall } from "./calendar.js";
import {
  SEARCH_TOOL,
  handleSearchToolCall,
  FETCH_TOOL,
  handleFetchToolCall,
} from "./search.js";
import { DATE_RANGE_TOOL, handleDateRangeToolCall } from "./dates.js";
import {
  OPENROUTER_BALANCE_TOOL,
  OPENROUTER_USAGE_TOOL,
  handleOpenrouterBalanceToolCall,
  handleOpenrouterUsageToolCall,
} from "./openrouter.js";
import { SPOTIFY_TOOLS, handleSpotifyToolCall } from "./spotify.js";
import { REMINDER_TOOLS, handleReminderToolCall } from "./reminders.js";
import { UPTIME_TOOL, handleUptimeToolCall } from "./uptime.js";
import { ENV_VARS_TOOL, handleEnvVarsToolCall } from "./env.js";
import { GITHUB_TOOLS, handleGithubToolCall } from "./github.js";
import { CODE_SEARCH_TOOL, handleCodeSearchToolCall } from "./codesearch.js";
import { log } from "./logger.js";

const NOTE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "rewrite_notes",
      description:
        "Overwrite the user's NOTES.md file with new content. Use this to add, update, remove, or reorganize notes. Always base the new content on the current file shown in the system prompt, merging new information into the appropriate sections rather than duplicating headings.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The complete new content for NOTES.md",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_note",
      description:
        "Edit the user's NOTES.md file by replacing existing text with new text. Use this to update, correct, or remove outdated notes.",
      parameters: {
        type: "object",
        properties: {
          old_text: {
            type: "string",
            description: "The existing text in NOTES.md to find and replace",
          },
          new_text: {
            type: "string",
            description:
              "The replacement text. Use an empty string to delete the old text.",
          },
        },
        required: ["old_text", "new_text"],
      },
    },
  },
];

const LIST_TOOLS_TOOL = {
  type: "function" as const,
  function: {
    name: "list_tools",
    description:
      "List all available tools with their trust level and a brief description.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

const DELEGATE_TO_UNTRUSTED_TOOL = {
  type: "function" as const,
  function: {
    name: "delegate_to_untrusted",
    description:
      "Delegate a task to an untrusted subagent that has access to web search and web fetch tools. Construct a focused prompt describing exactly what you need. The subagent cannot see your conversation history or personal context. Its response will be shown directly to the user.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "A self-contained prompt for the subagent. Include all necessary context since the subagent has no access to the conversation history.",
        },
      },
      required: ["prompt"],
    },
  },
};

export const TRUSTED_TOOLS = [
  ...NOTE_TOOLS,
  WEATHER_TOOL,
  ...CALENDAR_TOOLS,
  DATE_RANGE_TOOL,
  OPENROUTER_BALANCE_TOOL,
  OPENROUTER_USAGE_TOOL,
  ...REMINDER_TOOLS,
  UPTIME_TOOL,
  ENV_VARS_TOOL,
  CODE_SEARCH_TOOL,
  LIST_TOOLS_TOOL,
  DELEGATE_TO_UNTRUSTED_TOOL,
];

export const UNTRUSTED_TOOLS = [
  WEATHER_TOOL,
  SEARCH_TOOL,
  FETCH_TOOL,
  ...GITHUB_TOOLS,
  ...SPOTIFY_TOOLS,
];

export function formatToolList(): string {
  const trustedNames = new Set(TRUSTED_TOOLS.map((t) => t.function.name));
  const untrustedNames = new Set(UNTRUSTED_TOOLS.map((t) => t.function.name));

  const allTools = new Map<
    string,
    { description: string; trusted: boolean; untrusted: boolean }
  >();
  for (const t of [...TRUSTED_TOOLS, ...UNTRUSTED_TOOLS]) {
    const existing = allTools.get(t.function.name);
    if (existing) {
      existing.untrusted =
        existing.untrusted || untrustedNames.has(t.function.name);
      continue;
    }
    allTools.set(t.function.name, {
      description: t.function.description,
      trusted: trustedNames.has(t.function.name),
      untrusted: untrustedNames.has(t.function.name),
    });
  }

  const lines: string[] = [];
  for (const [name, info] of allTools) {
    const trust =
      info.trusted && info.untrusted
        ? "trusted + untrusted"
        : info.trusted
          ? "trusted"
          : "untrusted";
    const desc = info.description.split(".")[0];
    lines.push(`- **${name}** (${trust}): ${desc}.`);
  }

  return lines.join("\n");
}

export async function handleToolCall(
  name: string,
  argsJson: string,
  notesPath: string,
  source?: string,
): Promise<string> {
  log.debug(`Handling tool: ${name}`);

  if (name === "rewrite_notes") {
    const args = JSON.parse(argsJson) as { content: string };
    writeFileSync(notesPath, args.content, "utf-8");
    return "Done.";
  }

  if (name === "edit_note") {
    const args = JSON.parse(argsJson) as {
      old_text: string;
      new_text: string;
    };
    const current = existsSync(notesPath)
      ? readFileSync(notesPath, "utf-8")
      : "";
    if (!current.includes(args.old_text)) {
      return "Error: old_text not found in NOTES.md.";
    }
    const updated = current.replace(args.old_text, args.new_text);
    writeFileSync(notesPath, updated, "utf-8");
    return "Done.";
  }

  if (name === "get_weather") {
    return await handleWeatherToolCall(argsJson);
  }

  if (name === "web_search") {
    return await handleSearchToolCall(argsJson);
  }

  if (name === "web_fetch") {
    return await handleFetchToolCall(argsJson);
  }

  if (name === "compute_date_range") {
    return handleDateRangeToolCall(argsJson);
  }

  if (name === "openrouter_balance") {
    return await handleOpenrouterBalanceToolCall();
  }

  if (name === "get_uptime") {
    return handleUptimeToolCall();
  }

  if (name === "list_env_vars") {
    return handleEnvVarsToolCall();
  }

  if (name === "openrouter_usage") {
    return await handleOpenrouterUsageToolCall(argsJson);
  }

  if (name === "search_source_code") {
    return handleCodeSearchToolCall(argsJson);
  }

  if (name === "list_tools") {
    return formatToolList();
  }

  const calendarResult = await handleCalendarToolCall(name, argsJson);
  if (calendarResult !== null) {
    return calendarResult;
  }

  const spotifyResult = await handleSpotifyToolCall(name, argsJson);
  if (spotifyResult !== null) {
    return spotifyResult;
  }

  const githubResult = await handleGithubToolCall(name, argsJson);
  if (githubResult !== null) {
    return githubResult;
  }

  const dataDir = notesPath ? join(dirname(dirname(notesPath))) : "";
  const reminderResult = handleReminderToolCall(
    name,
    argsJson,
    dataDir,
    source ?? "cli",
  );
  if (reminderResult !== null) {
    return reminderResult;
  }

  log.warn(`Unknown tool: ${name}`);
  return `Error: unknown tool "${name}"`;
}
