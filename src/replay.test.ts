import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConversationEntry } from "./conversationlog.js";
import { entriesToMessages } from "./replay.js";

describe("entriesToMessages", () => {
  it("converts a simple prompt into system + user messages", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "hello" },
      { kind: "response", content: "hi there" },
    ];
    const messages = entriesToMessages("system prompt", entries);
    assert.deepEqual(messages, [
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello" },
    ]);
  });

  it("skips response entries so the model regenerates them", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "What time is it?" },
      { kind: "response", content: "It is 3pm" },
    ];
    const messages = entriesToMessages("sys", entries);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
  });

  it("converts tool input/output pairs into assistant + tool messages", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "What's the weather?" },
      {
        kind: "tool_input",
        name: "get_weather",
        content: '{"location": "London"}',
      },
      {
        kind: "tool_output",
        name: "get_weather",
        content: "Partly cloudy",
        duration_ms: 100,
      },
      { kind: "response", content: "It's partly cloudy" },
    ];
    const messages = entriesToMessages("sys", entries);

    assert.equal(messages.length, 4);
    assert.equal(messages[0].role, "system");
    assert.equal(messages[1].role, "user");
    assert.equal(messages[2].role, "assistant");

    const assistantMsg = messages[2] as {
      role: "assistant";
      toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    assert.equal(assistantMsg.toolCalls.length, 1);
    assert.equal(assistantMsg.toolCalls[0].function.name, "get_weather");
    assert.equal(
      assistantMsg.toolCalls[0].function.arguments,
      '{"location": "London"}',
    );

    const toolMsg = messages[3] as {
      role: "tool";
      toolCallId: string;
      content: string;
    };
    assert.equal(toolMsg.role, "tool");
    assert.equal(toolMsg.content, "Partly cloudy");
    assert.equal(toolMsg.toolCallId, assistantMsg.toolCalls[0].id);
  });

  it("handles multiple tool calls in sequence", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "Check weather and calendar" },
      {
        kind: "tool_input",
        name: "get_weather",
        content: '{"location": "NYC"}',
      },
      {
        kind: "tool_output",
        name: "get_weather",
        content: "Sunny",
        duration_ms: 50,
      },
      {
        kind: "tool_input",
        name: "list_calendar_events",
        content: '{"date": "2025-01-01"}',
      },
      {
        kind: "tool_output",
        name: "list_calendar_events",
        content: "No events",
        duration_ms: 80,
      },
      { kind: "response", content: "Sunny and free day" },
    ];
    const messages = entriesToMessages("sys", entries);

    // system + user + assistant(2 tool calls) + tool + tool = 5
    assert.equal(messages.length, 5);
    const assistantMsg = messages[2] as {
      role: "assistant";
      toolCalls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    assert.equal(assistantMsg.toolCalls.length, 2);
    assert.equal(assistantMsg.toolCalls[0].function.name, "get_weather");
    assert.equal(
      assistantMsg.toolCalls[1].function.name,
      "list_calendar_events",
    );
  });

  it("never includes tool execution — only recorded results", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "Remember this" },
      {
        kind: "tool_input",
        name: "append_note",
        content: '{"text": "important"}',
      },
      {
        kind: "tool_output",
        name: "append_note",
        content: "Done.",
        duration_ms: 5,
      },
      { kind: "response", content: "Noted." },
    ];
    const messages = entriesToMessages("sys", entries);

    // The tool message should contain the recorded output, not re-execute
    const toolMsg = messages[3] as {
      role: "tool";
      content: string;
    };
    assert.equal(toolMsg.content, "Done.");
  });
});
