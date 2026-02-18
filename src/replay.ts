import { readFileSync } from "node:fs";
import { OpenRouter } from "@openrouter/sdk";
import { ConversationEntry, parseConversationLog } from "./conversationlog.js";
import { log } from "./logger.js";

type Message =
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

function entriesToMessages(
  systemPrompt: string,
  entries: ConversationEntry[],
): Message[] {
  const messages: Message[] = [{ role: "system", content: systemPrompt }];

  let toolCallCounter = 0;
  let i = 0;

  while (i < entries.length) {
    const entry = entries[i];

    if (entry.kind === "prompt") {
      messages.push({ role: "user", content: entry.content });
      i++;
      continue;
    }

    if (entry.kind === "response") {
      // Skip response entries — these are what the model originally produced.
      // We want the model to regenerate the response.
      i++;
      continue;
    }

    if (entry.kind === "tool_input") {
      // Gather consecutive tool_input/tool_output pairs into one assistant
      // message with toolCalls followed by the corresponding tool results.
      const toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }> = [];
      const toolResults: Array<{ toolCallId: string; content: string }> = [];

      while (i < entries.length && entries[i].kind === "tool_input") {
        const input = entries[i] as Extract<
          ConversationEntry,
          { kind: "tool_input" }
        >;
        toolCallCounter++;
        const callId = `replay_${toolCallCounter}`;
        toolCalls.push({
          id: callId,
          type: "function",
          function: { name: input.name, arguments: input.content },
        });

        // The next entry should be the matching tool_output.
        if (i + 1 < entries.length && entries[i + 1].kind === "tool_output") {
          const output = entries[i + 1] as Extract<
            ConversationEntry,
            { kind: "tool_output" }
          >;
          toolResults.push({ toolCallId: callId, content: output.content });
          i += 2;
        } else {
          // tool_input without a matching output — skip the output.
          toolResults.push({
            toolCallId: callId,
            content: "(no output recorded)",
          });
          i++;
        }
      }

      messages.push({ role: "assistant", toolCalls });

      for (const result of toolResults) {
        messages.push({
          role: "tool",
          toolCallId: result.toolCallId,
          content: result.content,
        });
      }

      continue;
    }

    // tool_output without a preceding tool_input — skip.
    i++;
  }

  return messages;
}

async function replay(
  client: OpenRouter,
  model: string,
  systemPrompt: string,
  entries: ConversationEntry[],
): Promise<string> {
  const messages = entriesToMessages(systemPrompt, entries);

  log.debug(`Replaying with ${messages.length} messages`);

  const completion = await client.chat.send({
    chatGenerationParams: {
      model,
      messages,
      tools: [],
    },
  });

  const choice = completion.choices?.[0];
  const msg = choice?.message;
  if (!msg || !msg.content) {
    log.error("No response from model during replay");
    process.exit(1);
  }

  return msg.content as string;
}

function readLogFile(filePath: string): ConversationEntry[] {
  const text = readFileSync(filePath, "utf-8");
  return parseConversationLog(text);
}

export { entriesToMessages, readLogFile, replay };
