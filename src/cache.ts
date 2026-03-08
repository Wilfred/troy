type CacheControl = { type: "ephemeral" };

type ContentBlock = {
  type: "text";
  text: string;
  cacheControl?: CacheControl;
};

type PlainMessage =
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

type CachedSystemMessage = {
  role: "system";
  content: ContentBlock[];
};

type CachedUserMessage = {
  role: "user";
  content: ContentBlock[];
};

type CachedAssistantMessage = {
  role: "assistant";
  content: ContentBlock[];
};

type CachedToolMessage = {
  role: "tool";
  content: ContentBlock[];
  toolCallId: string;
};

type CachedMessage =
  | CachedSystemMessage
  | CachedUserMessage
  | CachedAssistantMessage
  | CachedToolMessage
  | PlainMessage;

function textBlock(text: string, cache: CacheControl): ContentBlock[] {
  return [{ type: "text" as const, text, cacheControl: cache }];
}

/**
 * Add cache breakpoints to messages for Anthropic prompt caching via OpenRouter.
 *
 * Places cache_control markers on:
 * 1. The system prompt (largest static block, cached across all requests)
 * 2. The second-to-last message (caches the conversation prefix so follow-up
 *    tool-loop calls only process newly appended messages)
 *
 * Returns a shallow copy — the original messages array is not mutated.
 */
export function addCacheBreakpoints(messages: PlainMessage[]): CachedMessage[] {
  if (messages.length === 0) return [];

  const result: CachedMessage[] = [...messages];
  const cache: CacheControl = { type: "ephemeral" };

  // 1. Cache the system prompt
  const first = messages[0];
  if (first.role === "system") {
    result[0] = { role: "system", content: textBlock(first.content, cache) };
  }

  // 2. Cache the second-to-last message to create a prefix breakpoint.
  //    This ensures follow-up calls (e.g. tool-call loops) reuse the cached
  //    prefix and only process the newly appended tail.
  const penIdx = messages.length - 2;
  if (penIdx > 0) {
    const pen = messages[penIdx];
    if (pen.role === "user") {
      result[penIdx] = {
        role: "user",
        content: textBlock(pen.content, cache),
      };
    } else if (
      pen.role === "assistant" &&
      typeof pen.content === "string" &&
      !pen.toolCalls
    ) {
      result[penIdx] = {
        role: "assistant",
        content: textBlock(pen.content, cache),
      };
    } else if (pen.role === "tool") {
      result[penIdx] = {
        role: "tool",
        content: textBlock(pen.content, cache),
        toolCallId: pen.toolCallId,
      };
    }
  }

  return result;
}
