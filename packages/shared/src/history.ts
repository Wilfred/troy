// Conversation history shared between the Troy and Duck bots.
//
// An exchange is a single user prompt paired with the assistant's reply. When
// a bot uses tools, the raw turn `messages` (assistant tool calls and tool
// results) are kept so the full tool-call history can be replayed; bots
// without tools leave `messages` empty and fall back to the plain
// user/assistant pair.

export type StoredToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type StoredMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content?: string | null;
      toolCalls?: StoredToolCall[];
    }
  | { role: "tool"; content: string; toolCallId: string };

export type Exchange = {
  user: string;
  assistant: string;
  messages: StoredMessage[];
};

/**
 * Expand a list of exchanges into the chat messages to prepend to a request.
 * Turns that recorded structured tool-call messages are replayed verbatim;
 * turns without them collapse to a plain user/assistant pair.
 */
export function historyToMessages(history: Exchange[]): StoredMessage[] {
  const messages: StoredMessage[] = [];
  for (const exchange of history) {
    if (exchange.messages.length > 0) {
      messages.push(...exchange.messages);
    } else {
      messages.push({ role: "user", content: exchange.user });
      messages.push({ role: "assistant", content: exchange.assistant });
    }
  }
  return messages;
}
