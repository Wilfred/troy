import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConversationEntry,
  formatConversationLog,
  writeConversationLog,
} from "./conversationlog.js";

function tmpDir(): string {
  const dir = join(
    tmpdir(),
    `troy-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("conversationlog", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("formats a simple prompt and response", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "foo bar" },
      { kind: "response", content: "baz" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(result, "Prompt:\n  foo bar\n\nResponse:\n  baz\n");
  });

  it("formats tool input and output with name", () => {
    const entries: ConversationEntry[] = [
      { kind: "tool_input", name: "calendar", content: "get today" },
      {
        kind: "tool_output",
        name: "calendar",
        content: "Vet appointment",
        duration_ms: 150,
      },
    ];
    const result = formatConversationLog(entries);
    assert.equal(
      result,
      "Tool Input name=calendar:\n  get today\n\n" +
        "Tool Output name=calendar duration=150ms:\n  Vet appointment\n",
    );
  });

  it("indents multiline content with two spaces per line", () => {
    const entries: ConversationEntry[] = [
      { kind: "response", content: "line one\nline two\nline three" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(result, "Response:\n  line one\n  line two\n  line three\n");
  });

  it("formats a full conversation with tools", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "foo bar" },
      { kind: "tool_input", name: "calendar", content: "get today" },
      {
        kind: "tool_output",
        name: "calendar",
        content: "Vet appointment",
        duration_ms: 230,
      },
      { kind: "response", content: "You have a vet appointment" },
    ];
    const result = formatConversationLog(entries);
    const expected =
      "Prompt:\n  foo bar\n\n" +
      "Tool Input name=calendar:\n  get today\n\n" +
      "Tool Output name=calendar duration=230ms:\n  Vet appointment\n\n" +
      "Response:\n  You have a vet appointment\n";
    assert.equal(result, expected);
  });

  it("writeConversationLog creates a file at the expected path", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "hello" },
      { kind: "response", content: "hi there" },
    ];
    const filePath = writeConversationLog(dir, 42, entries);
    assert.equal(filePath, join(dir, "logs", "C42.log"));
    const content = readFileSync(filePath, "utf-8");
    assert.equal(content, "Prompt:\n  hello\n\nResponse:\n  hi there\n");
  });

  it("writeConversationLog creates the logs subdirectory", () => {
    const nested = join(dir, "sub");
    const entries: ConversationEntry[] = [{ kind: "prompt", content: "test" }];
    const filePath = writeConversationLog(nested, 1, entries);
    const content = readFileSync(filePath, "utf-8");
    assert.equal(content, "Prompt:\n  test\n");
  });

  it("handles entries with empty content", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "" },
      { kind: "response", content: "" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(result, "Prompt:\n  \n\nResponse:\n  \n");
  });
});
