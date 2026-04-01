import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenRouter } from "@openrouter/sdk";
import { log } from "./logger.js";

interface SkillSummary {
  filename: string;
  description: string;
}

interface SkillFile {
  filename: string;
  description: string;
  body: string;
}

export function parseFrontMatter(content: string): {
  description: string;
  body: string;
} {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match) {
    return { description: "", body: content };
  }

  const yaml = match[1];
  const body = match[2];

  // Simple YAML parsing for description field only.
  const descMatch = /^description:\s*(.+)$/m.exec(yaml);
  const description = descMatch ? descMatch[1].trim() : "";

  return { description, body };
}

export function listSkillSummaries(skillsDir: string): SkillSummary[] {
  if (!existsSync(skillsDir)) return [];

  const files = readdirSync(skillsDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort();

  const summaries: SkillSummary[] = [];
  for (const file of files) {
    const content = readFileSync(join(skillsDir, file), "utf-8");
    const { description } = parseFrontMatter(content);
    if (description) {
      summaries.push({ filename: file, description });
    }
  }
  return summaries;
}

function loadSkillFile(skillsDir: string, filename: string): SkillFile {
  const content = readFileSync(join(skillsDir, filename), "utf-8");
  const { description, body } = parseFrontMatter(content);
  return { filename, description, body };
}

type SelectMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string };

const SELECT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "select_skills",
      description:
        "Select which skills are relevant to the user's prompt. Pass an empty array if none are relevant.",
      parameters: {
        type: "object",
        properties: {
          filenames: {
            type: "array",
            items: { type: "string" },
            description: "Array of skill filenames to load.",
          },
        },
        required: ["filenames"],
      },
    },
  },
];

export async function selectRelevantSkills(
  client: OpenRouter,
  model: string,
  skillsDir: string,
  prompt: string,
): Promise<string[]> {
  const summaries = listSkillSummaries(skillsDir);
  if (summaries.length === 0) return [];

  const catalog = summaries
    .map((s) => `- ${s.filename}: ${s.description}`)
    .join("\n");

  const messages: SelectMessage[] = [
    {
      role: "system",
      content: `You are a skill selector. Given a user prompt and a catalog of available skills, decide which skills (if any) are relevant. Call select_skills with the filenames of relevant skills, or an empty array if none match.

Available skills:
${catalog}`,
    },
    {
      role: "user",
      content: prompt,
    },
  ];

  try {
    const completion = await client.chat.send({
      chatGenerationParams: {
        model,
        messages,
        tools: SELECT_TOOLS,
      },
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg?.toolCalls || msg.toolCalls.length === 0) {
      log.debug("Skill selection: no tool calls, loading no skills");
      return [];
    }

    const call = msg.toolCalls[0];
    if (call.function.name === "select_skills") {
      const args = JSON.parse(call.function.arguments) as {
        filenames: string[];
      };
      const valid = args.filenames.filter((f: string) =>
        summaries.some((s) => s.filename === f),
      );
      log.info(`Skill selection: ${valid.length} skill(s) selected`);
      return valid;
    }
  } catch (err) {
    log.warn(
      `Skill selection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return [];
}

export function loadSelectedSkills(
  skillsDir: string,
  filenames: string[],
): string[] {
  return filenames.map((f) => {
    const skill = loadSkillFile(skillsDir, f);
    return skill.body;
  });
}

export function buildSkillCatalog(skillsDir: string): string {
  const summaries = listSkillSummaries(skillsDir);
  if (summaries.length === 0) return "";

  const lines = summaries.map((s) => `- ${s.filename}: ${s.description}`);
  return `\nAvailable skills (loaded when relevant):\n${lines.join("\n")}`;
}

export function readSkillRaw(skillsDir: string, filename: string): string {
  return readFileSync(join(skillsDir, filename), "utf-8");
}

export function writeSkillRaw(
  skillsDir: string,
  filename: string,
  content: string,
): void {
  writeFileSync(join(skillsDir, filename), content, "utf-8");
}
