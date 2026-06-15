import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StoredMessage, historyToMessages } from "@troy/shared";

describe("historyToMessages", () => {
  it("expands plain exchanges into user/assistant pairs", () => {
    const messages = historyToMessages([
      { user: "hi", assistant: "hello", messages: [] },
      { user: "bye", assistant: "later", messages: [] },
    ]);
    assert.deepEqual(messages, [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "bye" },
      { role: "assistant", content: "later" },
    ]);
  });

  it("replays structured tool-call messages verbatim", () => {
    const turn: StoredMessage[] = [
      { role: "user", content: "remind me" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "set_reminder", arguments: "{}" },
          },
        ],
      },
      { role: "tool", toolCallId: "call_1", content: "ok" },
      { role: "assistant", content: "Done" },
    ];
    const messages = historyToMessages([
      { user: "remind me", assistant: "Done", messages: turn },
    ]);
    assert.deepEqual(messages, turn);
  });

  it("returns no messages for empty history", () => {
    assert.deepEqual(historyToMessages([]), []);
  });
});
