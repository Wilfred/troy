import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { OpenRouter } from "@openrouter/sdk";
import { log } from "./logger.js";

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

const REFLECT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "rewrite_notes",
      description:
        "Overwrite NOTES.md with new content. Base the new content on the current notes, merging new information into the appropriate sections.",
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

function handleReflectToolCall(
  name: string,
  argsJson: string,
  notesPath: string,
): string {
  if (name === "no_update") {
    return "Done.";
  }

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
        tools: REFLECT_TOOLS,
      },
    });

    const msg = completion.choices?.[0]?.message;
    if (!msg?.toolCalls || msg.toolCalls.length === 0) {
      log.debug("Note reflection: no tool calls, skipping");
      return;
    }

    for (const toolCall of msg.toolCalls) {
      log.info(`Note reflection tool: ${toolCall.function.name}`);
      const result = handleReflectToolCall(
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
