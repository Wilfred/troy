import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  StoredMessage,
  createHistoryStore,
  historyToMessages,
  loadHistory,
  recordExchange,
} from "@troy/shared";

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

describe("in-memory history store", () => {
  it("keeps history separate per source", () => {
    const store = createHistoryStore();
    recordExchange(store, "a", { user: "q1", assistant: "r1", messages: [] });
    recordExchange(store, "b", { user: "q2", assistant: "r2", messages: [] });
    assert.deepEqual(loadHistory(store, "a"), [
      { user: "q1", assistant: "r1", messages: [] },
    ]);
    assert.deepEqual(loadHistory(store, "b"), [
      { user: "q2", assistant: "r2", messages: [] },
    ]);
  });

  it("returns an empty array for an unknown source", () => {
    assert.deepEqual(loadHistory(createHistoryStore(), "missing"), []);
  });

  it("trims to the most recent exchanges past the limit", () => {
    const store = createHistoryStore();
    for (let i = 0; i < 5; i++) {
      recordExchange(
        store,
        "a",
        { user: `q${i}`, assistant: `r${i}`, messages: [] },
        3,
      );
    }
    const history = loadHistory(store, "a");
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((e) => e.user),
      ["q2", "q3", "q4"],
    );
  });
});
