import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DISCORD_MAX_LENGTH, splitMessage } from "./discord.js";

describe("splitMessage", () => {
  it("returns short text as a single chunk", () => {
    assert.deepEqual(splitMessage("hello"), ["hello"]);
  });

  it("returns text at exactly the limit as a single chunk", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH);
    assert.deepEqual(splitMessage(text), [text]);
  });

  it("keeps every chunk within the limit", () => {
    const text = "word ".repeat(2000);
    const chunks = splitMessage(text);
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= DISCORD_MAX_LENGTH);
    }
  });

  it("prefers to break on newlines", () => {
    const line = "x".repeat(100);
    const text = Array.from({ length: 30 }, () => line).join("\n");
    const chunks = splitMessage(text);
    assert.ok(chunks.length > 1);
    // Every chunk should consist of whole lines, never a partial one.
    for (const chunk of chunks) {
      assert.ok(chunk.split("\n").every((l) => l === line));
    }
  });

  it("hard-cuts text with no break points", () => {
    const text = "a".repeat(DISCORD_MAX_LENGTH * 2 + 10);
    const chunks = splitMessage(text);
    assert.equal(chunks[0].length, DISCORD_MAX_LENGTH);
    assert.equal(chunks.join("").length, text.length);
  });
});
