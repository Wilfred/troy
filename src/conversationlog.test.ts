import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConversationEntry,
  formatConversationLog,
  openDb,
  writeConversationLog,
  loadRecentHistory,
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
  let dir = "";

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

  it("handles entries with empty content", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "" },
      { kind: "response", content: "" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(result, "Prompt:\n  \n\nResponse:\n  \n");
  });
});

describe("writeConversationLog and loadRecentHistory", () => {
  let dir = "";

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

  it("writeConversationLog returns an auto-incrementing id", () => {
    const db = openDb(dir);
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "hello" },
      { kind: "response", content: "hi there" },
    ];
    const id1 = writeConversationLog(db, entries);
    const id2 = writeConversationLog(db, entries);
    assert.equal(id1, 1);
    assert.equal(id2, 2);
  });

  it("writeConversationLog stores formatted content", () => {
    const db = openDb(dir);
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "hello" },
      { kind: "response", content: "hi there" },
    ];
    writeConversationLog(db, entries);
    const row = db
      .prepare("SELECT content FROM conversations WHERE id = 1")
      .get() as { content: string };
    assert.equal(row.content, "Prompt:\n  hello\n\nResponse:\n  hi there\n");
  });

  it("loadRecentHistory returns the last 2 exchanges in order", () => {
    const db = openDb(dir);
    const makeEntries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    writeConversationLog(db, makeEntries("q1", "a1"));
    writeConversationLog(db, makeEntries("q2", "a2"));
    writeConversationLog(db, makeEntries("q3", "a3"));
    const history = loadRecentHistory(db);
    assert.equal(history.length, 2);
    assert.deepEqual(history[0], { user: "q2", assistant: "a2" });
    assert.deepEqual(history[1], { user: "q3", assistant: "a3" });
  });

  it("loadRecentHistory filters by source", () => {
    const db = openDb(dir);
    const entries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    writeConversationLog(db, entries("cli1", "r1"), "cli");
    writeConversationLog(db, entries("discord1", "r2"), "discord:123");
    writeConversationLog(db, entries("cli2", "r3"), "cli");

    const cliHistory = loadRecentHistory(db, "cli");
    assert.equal(cliHistory.length, 2);
    assert.deepEqual(cliHistory[0], { user: "cli1", assistant: "r1" });
    assert.deepEqual(cliHistory[1], { user: "cli2", assistant: "r3" });

    const discordHistory = loadRecentHistory(db, "discord:123");
    assert.equal(discordHistory.length, 1);
    assert.deepEqual(discordHistory[0], { user: "discord1", assistant: "r2" });
  });

  it("loadRecentHistory returns empty array when no history exists", () => {
    const db = openDb(dir);
    assert.deepEqual(loadRecentHistory(db), []);
  });
});
