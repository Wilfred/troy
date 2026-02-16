import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getRecentMessages } from "./messages.js";

function tmpFile(): string {
  return join(tmpdir(), `troy-test-${Date.now()}-${Math.random()}.json`);
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

});
