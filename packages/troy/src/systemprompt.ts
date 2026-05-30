import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dateTimeContext } from "./dates.js";
import { buildSkillCatalog } from "./skills.js";
import { log } from "./logger.js";

export function buildSystemPrompt(
  dataDir: string,
  selectedSkillContents?: string[],
): string {
  let systemPrompt = readFileSync(
    new URL("../src/SYSTEM.md", import.meta.url),
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

  const skillsDir = join(dataDir, "skills");
  const skillsCount = selectedSkillContents?.length ?? 0;
  if (selectedSkillContents) {
    for (const content of selectedSkillContents) {
      systemPrompt += "\n\n" + content;
    }
  }

  // Always include the skill catalog so the model knows what skills exist.
  const catalog = buildSkillCatalog(skillsDir);
  if (catalog) {
    systemPrompt += "\n" + catalog;
  }

  log.debug(`Loaded ${rulesCount} rule(s) and ${skillsCount} skill(s)`);

  systemPrompt += `\n\n${dateTimeContext()}`;

  const currentUser = process.env.USER;
  if (currentUser) {
    systemPrompt += `\nThe current user's name is ${currentUser}.`;
  }

  return systemPrompt;
}
