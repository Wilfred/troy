import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ConversationEntry,
  StoredMessage,
  buildContextEntries,
  formatConversationLog,
  loadConversationEntries,
  openDb,
  writeConversationLog,
  loadRecentHistory,
} from "./conversationlog.js";
import { Conversation } from "./entities.js";

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

  it("formats a skills entry with selected filenames", () => {
    const entries: ConversationEntry[] = [
      { kind: "skills", filenames: ["weather.md", "calendar.md"] },
      { kind: "prompt", content: "foo" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(
      result,
      "Skills:\n  - weather.md\n  - calendar.md\n\nPrompt:\n  foo\n",
    );
  });

  it("formats an empty skills entry as (none)", () => {
    const entries: ConversationEntry[] = [
      { kind: "skills", filenames: [] },
      { kind: "prompt", content: "foo" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(result, "Skills:\n  (none)\n\nPrompt:\n  foo\n");
  });

  it("handles entries with empty content", () => {
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "" },
      { kind: "response", content: "" },
    ];
    const result = formatConversationLog(entries);
    assert.equal(result, "Prompt:\n  \n\nResponse:\n  \n");
  });

  it("buildContextEntries expands history tool calls into the formatted log", () => {
    const messages: StoredMessage[] = [
      { role: "user", content: "Just pick a time" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "set_reminder",
              arguments: '{"message":"x","remind_at":"2026-04-27T09:00:00"}',
            },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        content: "Reminder #13 set",
      },
      { role: "assistant", content: "Reminder set for tomorrow at 9am. ✓" },
    ];
    const entries = buildContextEntries("SYS", [
      { user: "Just pick a time", assistant: "Reminder set", messages },
    ]);
    const formatted = formatConversationLog(entries);
    assert.match(formatted, /History tool input name=set_reminder:/);
    assert.match(formatted, /History tool output name=set_reminder:/);
    assert.match(formatted, /Reminder #13 set/);
  });
});

describe("loadConversationEntries", () => {
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

  it("returns null for legacy rows without entries", () => {
    assert.equal(
      loadConversationEntries({
        id: 1,
        source: "cli",
        prompt: "p",
        response: "r",
        content: "Prompt:\n  p\n\nResponse:\n  r\n",
        entries: null,
        messages: null,
        created_at: "2026-04-27 00:00:00",
      }),
      null,
    );
  });

  it("round-trips a full conversation persisted to the database", async () => {
    const entries: ConversationEntry[] = [
      { kind: "system", content: "you are a helpful assistant" },
      { kind: "skills", filenames: ["calendar.md"] },
      { kind: "history", role: "user", content: "earlier question" },
      { kind: "history", role: "assistant", content: "earlier answer" },
      { kind: "prompt", content: "what's on my calendar?" },
      { kind: "tool_input", name: "calendar", content: "get today" },
      {
        kind: "tool_output",
        name: "calendar",
        content: "Vet appointment\n\nDentist",
        duration_ms: 150,
      },
      { kind: "response", content: "You have a vet appointment." },
    ];
    const db = await openDb(dir);
    const id = await writeConversationLog(db, entries);
    const row = await db
      .getRepository(Conversation)
      .findOneOrFail({ where: { id } });
    assert.deepEqual(loadConversationEntries(row), entries);
    await db.destroy();
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

  it("writeConversationLog returns an auto-incrementing id", async () => {
    const db = await openDb(dir);
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "hello" },
      { kind: "response", content: "hi there" },
    ];
    const id1 = await writeConversationLog(db, entries);
    const id2 = await writeConversationLog(db, entries);
    assert.equal(id1, 1);
    assert.equal(id2, 2);
    await db.destroy();
  });

  it("writeConversationLog stores formatted content", async () => {
    const db = await openDb(dir);
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "hello" },
      { kind: "response", content: "hi there" },
    ];
    await writeConversationLog(db, entries);
    const row = await db
      .getRepository(Conversation)
      .findOneOrFail({ where: { id: 1 } });
    assert.equal(row.content, "Prompt:\n  hello\n\nResponse:\n  hi there\n");
    await db.destroy();
  });

  it("loadRecentHistory returns the last 3 exchanges in order when older than 1 hour", async () => {
    const db = await openDb(dir);
    const makeEntries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    await writeConversationLog(db, makeEntries("q1", "a1"));
    await writeConversationLog(db, makeEntries("q2", "a2"));
    await writeConversationLog(db, makeEntries("q3", "a3"));
    await writeConversationLog(db, makeEntries("q4", "a4"));
    // Backdate all entries so only the "last 3" logic applies.
    await db.query(
      "UPDATE conversations SET created_at = datetime('now', '-2 hours')",
    );
    const history = await loadRecentHistory(db);
    assert.equal(history.length, 3);
    assert.deepEqual(history[0], {
      user: "q2",
      assistant: "a2",
      messages: [],
    });
    assert.deepEqual(history[1], {
      user: "q3",
      assistant: "a3",
      messages: [],
    });
    assert.deepEqual(history[2], {
      user: "q4",
      assistant: "a4",
      messages: [],
    });
    await db.destroy();
  });

  it("loadRecentHistory filters by source", async () => {
    const db = await openDb(dir);
    const entries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    await writeConversationLog(db, entries("cli1", "r1"), "cli");
    await writeConversationLog(db, entries("discord1", "r2"), "discord:123");
    await writeConversationLog(db, entries("cli2", "r3"), "cli");

    const cliHistory = await loadRecentHistory(db, "cli");
    assert.equal(cliHistory.length, 2);
    assert.deepEqual(cliHistory[0], {
      user: "cli1",
      assistant: "r1",
      messages: [],
    });
    assert.deepEqual(cliHistory[1], {
      user: "cli2",
      assistant: "r3",
      messages: [],
    });

    const discordHistory = await loadRecentHistory(db, "discord:123");
    assert.equal(discordHistory.length, 1);
    assert.deepEqual(discordHistory[0], {
      user: "discord1",
      assistant: "r2",
      messages: [],
    });
    await db.destroy();
  });

  it("loadRecentHistory returns empty array when no history exists", async () => {
    const db = await openDb(dir);
    assert.deepEqual(await loadRecentHistory(db), []);
    await db.destroy();
  });

  it("loadRecentHistory includes all discussions from the last hour", async () => {
    const db = await openDb(dir);
    const entries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    // Insert 5 conversations: first 3 older than 1 hour, last 2 recent.
    await writeConversationLog(db, entries("old1", "a1"));
    await writeConversationLog(db, entries("old2", "a2"));
    await writeConversationLog(db, entries("old3", "a3"));
    await writeConversationLog(db, entries("recent1", "a4"));
    await writeConversationLog(db, entries("recent2", "a5"));

    // Backdate the first three to 2 hours ago.
    await db.query(
      "UPDATE conversations SET created_at = datetime('now', '-2 hours') WHERE id IN (1, 2, 3)",
    );

    // Without time-based logic, we'd only get the last 3 (old3, recent1, recent2).
    // With last-hour logic, we still get recent1 + recent2 (both are within the hour),
    // plus old3 from the "last 3" logic — 3 total after dedup.
    const history = await loadRecentHistory(db);
    assert.equal(history.length, 3);
    assert.deepEqual(history[0], {
      user: "old3",
      assistant: "a3",
      messages: [],
    });
    assert.deepEqual(history[1], {
      user: "recent1",
      assistant: "a4",
      messages: [],
    });
    assert.deepEqual(history[2], {
      user: "recent2",
      assistant: "a5",
      messages: [],
    });
    await db.destroy();
  });

  it("loadRecentHistory merges last-hour and recent exchanges without duplicates", async () => {
    const db = await openDb(dir);
    const entries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    // Insert 5 conversations, all recent (within the hour).
    await writeConversationLog(db, entries("q1", "a1"));
    await writeConversationLog(db, entries("q2", "a2"));
    await writeConversationLog(db, entries("q3", "a3"));
    await writeConversationLog(db, entries("q4", "a4"));
    await writeConversationLog(db, entries("q5", "a5"));

    // All 5 are within the last hour, so all should be included.
    const history = await loadRecentHistory(db);
    assert.equal(history.length, 5);
    assert.deepEqual(history[0], {
      user: "q1",
      assistant: "a1",
      messages: [],
    });
    assert.deepEqual(history[4], {
      user: "q5",
      assistant: "a5",
      messages: [],
    });
    await db.destroy();
  });

  it("writeConversationLog persists structured messages and loadRecentHistory returns them", async () => {
    const db = await openDb(dir);
    const entries: ConversationEntry[] = [
      { kind: "prompt", content: "remind me" },
      {
        kind: "tool_input",
        name: "set_reminder",
        content: '{"message":"x"}',
      },
      {
        kind: "tool_output",
        name: "set_reminder",
        content: "ok",
        duration_ms: 1,
      },
      { kind: "response", content: "Done" },
    ];
    const messages: StoredMessage[] = [
      { role: "user", content: "remind me" },
      {
        role: "assistant",
        content: null,
        toolCalls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "set_reminder", arguments: '{"message":"x"}' },
          },
        ],
      },
      { role: "tool", toolCallId: "call_1", content: "ok" },
      { role: "assistant", content: "Done" },
    ];
    await writeConversationLog(db, entries, undefined, messages);
    const history = await loadRecentHistory(db);
    assert.equal(history.length, 1);
    assert.deepEqual(history[0].messages, messages);
    await db.destroy();
  });

  it("loadRecentHistory includes old recent exchanges even if outside the hour", async () => {
    const db = await openDb(dir);
    const entries = (p: string, r: string): ConversationEntry[] => [
      { kind: "prompt", content: p },
      { kind: "response", content: r },
    ];
    // Insert 4 conversations, all old.
    await writeConversationLog(db, entries("q1", "a1"));
    await writeConversationLog(db, entries("q2", "a2"));
    await writeConversationLog(db, entries("q3", "a3"));
    await writeConversationLog(db, entries("q4", "a4"));

    // Backdate all to 2 hours ago.
    await db.query(
      "UPDATE conversations SET created_at = datetime('now', '-2 hours')",
    );

    // Even though none are in the last hour, the 3 most recent should still be returned.
    const history = await loadRecentHistory(db);
    assert.equal(history.length, 3);
    assert.deepEqual(history[0], {
      user: "q2",
      assistant: "a2",
      messages: [],
    });
    assert.deepEqual(history[1], {
      user: "q3",
      assistant: "a3",
      messages: [],
    });
    assert.deepEqual(history[2], {
      user: "q4",
      assistant: "a4",
      messages: [],
    });
    await db.destroy();
  });
});
