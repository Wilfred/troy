import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function searchSourceCode(pattern: string, filenameFilter?: string): string {
  log.info(
    `Code search: pattern="${pattern}" filter="${filenameFilter ?? ""}"`,
  );

  let files: string[] = [];
  try {
    files = readdirSync(SRC_DIR).filter((f: string) => f.endsWith(".ts"));
  } catch (err) {
    return `Error: could not read source directory: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (filenameFilter) {
    files = files.filter((f) => f.includes(filenameFilter));
  }

  let regex: RegExp = /(?:)/;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return `Error: invalid regex pattern "${pattern}"`;
  }

  const results: string[] = [];
  for (const file of files) {
    const filePath = join(SRC_DIR, file);
    let content: string = "";
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push(`${file}:${i + 1}: ${lines[i]}`);
      }
    }
  }

  if (results.length === 0) {
    return `No matches found for pattern: ${pattern}`;
  }

  return results.join("\n");
}

export const CODE_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "search_source_code",
    description:
      "Search Troy's TypeScript source files for a pattern. Returns matching lines with filename and line number. Use this to understand how Troy is implemented, find where a function is defined, or explore the codebase.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "A regular expression (or literal string) to search for across all source files",
        },
        filename_filter: {
          type: "string",
          description:
            "Optional substring to filter which source files are searched (e.g. 'tools' to search only tools.ts)",
        },
      },
      required: ["pattern"],
    },
  },
};

export function handleCodeSearchToolCall(argsJson: string): string {
  const args = JSON.parse(argsJson) as {
    pattern: string;
    filename_filter?: string;
  };
  return searchSourceCode(args.pattern, args.filename_filter);
}
