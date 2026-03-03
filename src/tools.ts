import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { weatherTool, handleWeatherToolCall } from "./weather.js";
import { calendarTools, handleCalendarToolCall } from "./calendar.js";
import {
  searchTool,
  handleSearchToolCall,
  fetchTool,
  handleFetchToolCall,
} from "./search.js";
import { dateRangeTool, handleDateRangeToolCall } from "./dates.js";
import {
  openrouterBalanceTool,
  openrouterUsageTool,
  handleOpenrouterBalanceToolCall,
  handleOpenrouterUsageToolCall,
} from "./openrouter.js";
import { log, setLogLevel } from "./logger.js";
import {
  getSecretSettings,
  getNonSensitiveSettings,
  isNonSensitiveKey,
  updateSetting,
  nonSensitiveKeys,
} from "./settings.js";

const noteTools = [
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

const viewSettingsTool = {
  type: "function" as const,
  function: {
    name: "view_settings",
    description:
      "View the current settings. Secret values (API keys, tokens) are redacted.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const modifySettingsTool = {
  type: "function" as const,
  function: {
    name: "modify_settings",
    description: `Modify a non-sensitive setting. Changes are persisted to the data directory and survive restarts. Valid keys: ${nonSensitiveKeys.join(", ")}.`,
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          enum: nonSensitiveKeys,
          description: "The setting to modify.",
        },
        value: {
          type: "string",
          description:
            "The new value. For googleCalendarAllowWrites use 'true' or 'false'.",
        },
      },
      required: ["key", "value"],
    },
  },
};

const delegateToUntrustedTool = {
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

export const trustedTools = [
  ...noteTools,
  weatherTool,
  ...calendarTools,
  dateRangeTool,
  openrouterBalanceTool,
  openrouterUsageTool,
  viewSettingsTool,
  modifySettingsTool,
  delegateToUntrustedTool,
];

export const untrustedTools = [weatherTool, searchTool, fetchTool];

function handleViewSettings(): string {
  const secret = getSecretSettings();
  const nonSensitive = getNonSensitiveSettings();

  const redacted = "[REDACTED]";
  const output = {
    secrets: {
      openrouterApiKey: secret.openrouterApiKey ? redacted : "(not set)",
      discordBotToken: secret.discordBotToken ? redacted : "(not set)",
      braveSearchApiKey: secret.braveSearchApiKey ? redacted : "(not set)",
      googleClientId: secret.googleClientId ? redacted : "(not set)",
      googleClientSecret: secret.googleClientSecret ? redacted : "(not set)",
      googleRefreshToken: secret.googleRefreshToken ? redacted : "(not set)",
      discordAllowlist:
        secret.discordAllowlist.length > 0 ? redacted : "(not set)",
    },
    settings: nonSensitive,
  };

  return JSON.stringify(output, null, 2);
}

function handleModifySettings(argsJson: string): string {
  const args = JSON.parse(argsJson) as { key: string; value: string };

  if (!isNonSensitiveKey(args.key)) {
    return `Error: '${args.key}' is not a valid modifiable setting key.`;
  }

  updateSetting(args.key, args.value);

  if (args.key === "logLevel") {
    setLogLevel(args.value);
  }

  return `Setting '${args.key}' updated to '${args.value}'.`;
}

export async function handleToolCall(
  name: string,
  argsJson: string,
  notesPath: string,
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

  if (name === "openrouter_usage") {
    return await handleOpenrouterUsageToolCall(argsJson);
  }

  if (name === "view_settings") {
    return handleViewSettings();
  }

  if (name === "modify_settings") {
    return handleModifySettings(argsJson);
  }

  const calendarResult = await handleCalendarToolCall(name, argsJson);
  if (calendarResult !== null) {
    return calendarResult;
  }

  log.warn(`Unknown tool: ${name}`);
  return `Error: unknown tool "${name}"`;
}
