import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readSkillRaw, writeSkillRaw } from "./skills.js";
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
import { TFL_TOOLS, handleTflToolCall } from "./tfl.js";
import { HUE_TOOLS, handleHueToolCall } from "./hue.js";
import { log } from "./logger.js";

const NOTE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "append_note",
      description:
        "Append text to the end of the user's NOTES.md file. Use this to add new information. Do NOT use this for date-specific reminders or events — use create_calendar_event instead.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The text to append to NOTES.md. Include a leading newline if you want a blank line before the new content.",
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

const SKILL_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_skill",
      description:
        "Read the full contents of a skill file (YAML front matter + body) from the skills directory. Useful for inspecting a skill before editing it.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The skill filename (e.g. cooking.md).",
          },
        },
        required: ["filename"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_skill",
      description:
        "Edit a skill file by replacing existing text with new text. Operates on the entire raw file, including the YAML front matter, so you can update the description or body. Use an empty new_text to delete the matched text.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The skill filename (e.g. cooking.md).",
          },
          old_text: {
            type: "string",
            description:
              "The existing text in the skill file to find and replace.",
          },
          new_text: {
            type: "string",
            description:
              "The replacement text. Use an empty string to delete the old text.",
          },
        },
        required: ["filename", "old_text", "new_text"],
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
  ...SKILL_TOOLS,
  WEATHER_TOOL,
  ...CALENDAR_TOOLS,
  DATE_RANGE_TOOL,
  OPENROUTER_BALANCE_TOOL,
  OPENROUTER_USAGE_TOOL,
  ...REMINDER_TOOLS,
  UPTIME_TOOL,
  ENV_VARS_TOOL,
  CODE_SEARCH_TOOL,
  ...TFL_TOOLS,
  ...HUE_TOOLS,
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

function skillsDirFromNotes(notesPath: string): string {
  return join(dirname(dirname(notesPath)), "skills");
}

export async function handleToolCall(
  name: string,
  argsJson: string,
  notesPath: string,
  source?: string,
): Promise<string> {
  log.debug(`Handling tool: ${name}`);

  if (name === "append_note") {
    const args = JSON.parse(argsJson) as { content: string };
    const current = existsSync(notesPath)
      ? readFileSync(notesPath, "utf-8")
      : "";
    writeFileSync(notesPath, current + args.content, "utf-8");
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

  if (name === "read_skill") {
    const args = JSON.parse(argsJson) as { filename: string };
    try {
      return readSkillRaw(skillsDirFromNotes(notesPath), args.filename);
    } catch {
      return `Error: skill file "${args.filename}" not found.`;
    }
  }

  if (name === "edit_skill") {
    const args = JSON.parse(argsJson) as {
      filename: string;
      old_text: string;
      new_text: string;
    };
    const skillsDir = skillsDirFromNotes(notesPath);
    try {
      const current = readSkillRaw(skillsDir, args.filename);
      if (!current.includes(args.old_text)) {
        return `Error: old_text not found in ${args.filename}.`;
      }
      const updated = current.replace(args.old_text, args.new_text);
      writeSkillRaw(skillsDir, args.filename, updated);
      return "Done.";
    } catch {
      return `Error: skill file "${args.filename}" not found.`;
    }
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

  const tflResult = await handleTflToolCall(name, argsJson);
  if (tflResult !== null) {
    return tflResult;
  }

  const hueResult = await handleHueToolCall(name, argsJson);
  if (hueResult !== null) {
    return hueResult;
  }

  const dataDir = notesPath ? join(dirname(dirname(notesPath))) : "";
  const reminderResult = await handleReminderToolCall(
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
