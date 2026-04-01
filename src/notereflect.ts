import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { OpenRouter } from "@openrouter/sdk";
import { log } from "./logger.js";
import {
  listSkillSummaries,
  readSkillRaw,
  writeSkillRaw,
  parseFrontMatter,
} from "./skills.js";

type ReflectMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string | null;
      toolCalls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; content: string; toolCallId: string };

const NOTE_REFLECT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "append_note",
      description:
        "Append text to the end of NOTES.md. Use this to add new information.",
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
      description: "Edit NOTES.md by replacing existing text with new text.",
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
  {
    type: "function" as const,
    function: {
      name: "no_update",
      description: "Call this when no note update is needed.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const SKILL_REFLECT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "update_skill",
      description:
        "Update an existing skill file. Provide the filename, and optionally a new description and/or new body. Only provided fields are changed.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The skill filename (e.g. cooking.md).",
          },
          description: {
            type: "string",
            description:
              "New description for the YAML front matter. Omit to keep the current description.",
          },
          body: {
            type: "string",
            description:
              "New body content (everything after the front matter). Omit to keep the current body.",
          },
        },
        required: ["filename"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_skill",
      description:
        "Create a new skill file with a description and body content.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description:
              "The skill filename (e.g. cooking.md). Must end with .md.",
          },
          description: {
            type: "string",
            description: "A short description of what this skill covers.",
          },
          body: {
            type: "string",
            description: "The markdown body content of the skill.",
          },
        },
        required: ["filename", "description", "body"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "no_skill_update",
      description: "Call this when no skill updates are needed.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function handleNoteReflectToolCall(
  name: string,
  argsJson: string,
  notesPath: string,
): string {
  if (name === "no_update") {
    return "Done.";
  }

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

  return `Error: unknown tool "${name}"`;
}

function handleSkillReflectToolCall(
  name: string,
  argsJson: string,
  skillsDir: string,
): string {
  if (name === "no_skill_update") {
    return "Done.";
  }

  if (name === "create_skill") {
    const args = JSON.parse(argsJson) as {
      filename: string;
      description: string;
      body: string;
    };
    if (!args.filename.endsWith(".md")) {
      return "Error: filename must end with .md";
    }
    const content = `---\ndescription: ${args.description}\n---\n${args.body}`;
    writeSkillRaw(skillsDir, args.filename, content);
    return "Done.";
  }

  if (name === "update_skill") {
    const args = JSON.parse(argsJson) as {
      filename: string;
      description?: string;
      body?: string;
    };
    try {
      const current = readSkillRaw(skillsDir, args.filename);
      const parsed = parseFrontMatter(current);
      const newDesc = args.description ?? parsed.description;
      const newBody = args.body ?? parsed.body;
      const updated = `---\ndescription: ${newDesc}\n---\n${newBody}`;
      writeSkillRaw(skillsDir, args.filename, updated);
      return "Done.";
    } catch {
      return `Error: skill file "${args.filename}" not found.`;
    }
  }

  return `Error: unknown tool "${name}"`;
}

export async function reflectOnNotes(
  client: OpenRouter,
  model: string,
  notesPath: string,
  userPrompt: string,
  assistantResponse: string,
): Promise<void> {
  const currentNotes = existsSync(notesPath)
    ? readFileSync(notesPath, "utf-8")
    : "";

  const systemPrompt = `You are a memory manager. Your job is to decide whether NOTES.md should be updated based on a conversation exchange.

NOTES.md stores personal facts, preferences, and context about the user to help the assistant give better responses in future conversations. Think of it as the assistant's long-term memory.

Current NOTES.md:
${currentNotes ? `\`\`\`\n${currentNotes}\n\`\`\`` : "(empty)"}

Rules:
- Save facts about the user: name, location, preferences, relationships, work, projects, pets, routines, etc.
- Save things the user has asked you to remember or correct.
- Update or remove notes that the conversation reveals to be outdated or incorrect.
- Do NOT save transient information (today's weather, what time a meeting is, task status).
- Do NOT save every conversation topic — only things that would be useful context in future conversations.
- Keep notes concise and well-organized with markdown headings.
- If the current notes already cover everything relevant, call no_update.
- Most conversations will NOT require a note update. Only update when there is genuinely new personal information.`;

  const messages: ReflectMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `User said: ${userPrompt}\n\nAssistant responded: ${assistantResponse}`,
    },
  ];

  try {
    const completion = await client.chat.send({
      chatGenerationParams: {
        model,
        messages,
        tools: NOTE_REFLECT_TOOLS,
      },
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg?.toolCalls || msg.toolCalls.length === 0) {
      log.debug("Note reflection: no tool calls, skipping");
      return;
    }

    for (const toolCall of msg.toolCalls) {
      log.info(`Note reflection tool: ${toolCall.function.name}`);
      const result = handleNoteReflectToolCall(
        toolCall.function.name,
        toolCall.function.arguments,
        notesPath,
      );
      if (result !== "Done.") {
        log.warn(`Note reflection tool issue: ${result}`);
      }
    }
  } catch (err) {
    log.warn(
      `Note reflection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function reflectOnSkills(
  client: OpenRouter,
  model: string,
  skillsDir: string,
  userPrompt: string,
  assistantResponse: string,
): Promise<void> {
  const summaries = listSkillSummaries(skillsDir);
  const catalog =
    summaries.length > 0
      ? summaries.map((s) => `- ${s.filename}: ${s.description}`).join("\n")
      : "(no skills exist yet)";

  const systemPrompt = `You are a skill manager. Your job is to decide whether any skill files should be created or updated based on a conversation exchange.

Skills are markdown files that store knowledge, procedures, and how-to guides. Each skill has a description (in YAML front matter) and a body (markdown content). Skills are loaded into the assistant's context when they match a user's prompt, so they should contain useful reference material.

Existing skills:
${catalog}

Rules:
- Create a new skill when the conversation reveals reusable knowledge, procedures, or how-to guides that would help in future similar requests.
- Update an existing skill when the conversation adds new information, corrections, or improvements relevant to that skill's topic.
- Skills should contain actionable knowledge: steps, commands, configurations, preferences, patterns, etc.
- Keep skill descriptions concise — they are used to decide when to load the skill.
- Do NOT create skills for one-off questions or transient information.
- Do NOT duplicate information that belongs in NOTES.md (personal facts, preferences).
- If no skill update is needed, call no_skill_update.
- Most conversations will NOT require a skill update. Only update when there is genuinely reusable knowledge.`;

  const messages: ReflectMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `User said: ${userPrompt}\n\nAssistant responded: ${assistantResponse}`,
    },
  ];

  try {
    const completion = await client.chat.send({
      chatGenerationParams: {
        model,
        messages,
        tools: SKILL_REFLECT_TOOLS,
      },
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg?.toolCalls || msg.toolCalls.length === 0) {
      log.debug("Skill reflection: no tool calls, skipping");
      return;
    }

    for (const toolCall of msg.toolCalls) {
      log.info(`Skill reflection tool: ${toolCall.function.name}`);
      const result = handleSkillReflectToolCall(
        toolCall.function.name,
        toolCall.function.arguments,
        skillsDir,
      );
      if (result !== "Done.") {
        log.warn(`Skill reflection tool issue: ${result}`);
      }
    }
  } catch (err) {
    log.warn(
      `Skill reflection failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
