import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { weatherTool, handleWeatherToolCall } from "./weather.js";
import { calendarTools, handleCalendarToolCall } from "./calendar.js";
import {
  searchTool,
  handleSearchToolCall,
  fetchTool,
  handleFetchToolCall,
} from "./search.js";
import { log } from "./logger.js";

export type ToolMode = "trusted" | "untrusted";

const noteTools = [
  {
    type: "function" as const,
    function: {
      name: "append_note",
      description:
        "Append text to the user's NOTES.md file. Use this to save information the user asks you to remember.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to append to NOTES.md",
          },
        },
        required: ["text"],
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

const switchToUntrustedTool = {
  type: "function" as const,
  function: {
    name: "switch_to_untrusted",
    description:
      "Switch to untrusted tool mode. In this mode, only read-only tools are available and you cannot modify notes or calendar events. This transition is one-way and cannot be reversed.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

const searchTools = process.env.BRAVE_SEARCH_API_KEY
  ? [searchTool, fetchTool]
  : [];

export const trustedTools = [
  ...noteTools,
  weatherTool,
  ...calendarTools,
  switchToUntrustedTool,
];

export const untrustedTools = [weatherTool, ...searchTools];

export function toolsForMode(
  mode: ToolMode,
): (typeof trustedTools | typeof untrustedTools)[number][] {
  return mode === "trusted" ? trustedTools : untrustedTools;
}

export async function handleToolCall(
  name: string,
  argsJson: string,
  notesPath: string,
): Promise<string> {
  log.debug(`Handling tool: ${name}`);

  if (name === "switch_to_untrusted") {
    log.info("Switching to untrusted tool mode");
    return "Switched to untrusted tool mode. Only read-only tools are now available.";
  }

  if (name === "append_note") {
    const args = JSON.parse(argsJson) as { text: string };
    appendFileSync(notesPath, args.text + "\n", "utf-8");
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

  const calendarResult = await handleCalendarToolCall(name, argsJson);
  if (calendarResult !== null) {
    return calendarResult;
  }

  log.warn(`Unknown tool: ${name}`);
  return `Error: unknown tool "${name}"`;
}
