import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { weekContext } from "./dates.js";
import { log } from "./logger.js";

function getInitialSentence(prompt: string): string {
  const match = /^[^.!?]*[.!?]?/.exec(prompt);
  return match ? match[0].toLowerCase() : prompt.toLowerCase();
}

function loadMatchingSkills(skillsDir: string, prompt: string): string[] {
  if (!existsSync(skillsDir)) return [];
  const sentence = getInitialSentence(prompt);
  const files = readdirSync(skillsDir)
    .filter((f: string) => f.endsWith(".md"))
    .sort();
  const result: string[] = [];
  for (const file of files) {
    const skillName = file
      .replace(/\.md$/, "")
      .replace(/[-_]/g, " ")
      .toLowerCase();
    const words: string[] = skillName
      .split(/\s+/)
      .filter((w: string) => w.length > 2);
    if (words.some((w: string) => sentence.includes(w))) {
      result.push(readFileSync(join(skillsDir, file), "utf-8"));
    }
  }
  return result;
}

export function buildSystemPrompt(dataDir: string, prompt?: string): string {
  let systemPrompt = readFileSync(
    new URL("../SYSTEM.md", import.meta.url),
    "utf-8",
  );

  const rulesDir = join(dataDir, "rules");
  let rulesCount = 0;
  if (existsSync(rulesDir)) {
    const mdFiles = readdirSync(rulesDir)
      .filter((f: string) => f.endsWith(".md"))
      .sort();
    rulesCount = mdFiles.length;
    for (const file of mdFiles) {
      systemPrompt += "\n\n" + readFileSync(join(rulesDir, file), "utf-8");
    }
  }

  let skillsCount = 0;
  if (prompt) {
    const skillsDir = join(dataDir, "skills");
    const matchedSkills = loadMatchingSkills(skillsDir, prompt);
    skillsCount = matchedSkills.length;
    for (const content of matchedSkills) {
      systemPrompt += "\n\n" + content;
    }
  }
  log.debug(`Loaded ${rulesCount} rule(s) and ${skillsCount} skill(s)`);

  systemPrompt += `\n\n${weekContext()}`;

  const currentUser = process.env.USER;
  if (currentUser) {
    systemPrompt += `\nThe current user's name is ${currentUser}.`;
  }

  return systemPrompt;
}
