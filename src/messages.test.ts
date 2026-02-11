import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getRecentMessages, getAllMessages } from "./messages.js";

function tmpFile(): string {
  return join(tmpdir(), `troy-test-${Date.now()}-${Math.random()}.json`);
}

function toDateString(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("messages", () => {
  let path: string;

  beforeEach(() => {
    path = tmpFile();
  });

  afterEach(() => {
    try {
      unlinkSync(path);
    } catch {
      // ignore
    }
  });

  it("getAllMessages formats messages grouped by date", () => {
    const ts1 = new Date("2025-01-15T10:00:00Z").getTime();
    const ts2 = new Date("2025-01-15T11:00:00Z").getTime();
    const ts3 = new Date("2025-01-16T09:00:00Z").getTime();

    writeFileSync(
      path,
      JSON.stringify({
        messages: [
          { senderName: "Alice", text: "Hello", timestamp: ts1, type: "text" },
          { senderName: "Bob", text: "Hi", timestamp: ts2, type: "text" },
          { senderName: "Alice", text: "Bye", timestamp: ts3, type: "text" },
        ],
      }),
    );

    const result = getAllMessages(path);
    const date1 = toDateString(ts1);
    const date2 = toDateString(ts3);

    assert.ok(result.includes(`### ${date1}`));
    assert.ok(result.includes(`### ${date2}`));
    assert.ok(result.includes("Alice: Hello"));
    assert.ok(result.includes("Bob: Hi"));
    assert.ok(result.includes("Alice: Bye"));
  });

  it("getRecentMessages returns only the last N messages", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      senderName: "User",
      text: `msg-${i}`,
      timestamp: new Date("2025-03-01T00:00:00Z").getTime() + i * 60000,
      type: "text",
    }));

    writeFileSync(path, JSON.stringify({ messages }));

    const result = getRecentMessages(path, 3);
    assert.ok(!result.includes("msg-6"));
    assert.ok(result.includes("msg-7"));
    assert.ok(result.includes("msg-8"));
    assert.ok(result.includes("msg-9"));
  });

  it("getRecentMessages handles empty messages array", () => {
    writeFileSync(path, JSON.stringify({ messages: [] }));
    const result = getRecentMessages(path, 5);
    assert.equal(result, "");
  });

  it("today's messages get labeled 'Today'", () => {
    const now = Date.now();
    writeFileSync(
      path,
      JSON.stringify({
        messages: [
          { senderName: "User", text: "now", timestamp: now, type: "text" },
        ],
      }),
    );

    const result = getAllMessages(path);
    assert.ok(result.includes("### Today"));
  });
});
