import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleToolCall } from "./tools.js";

function tmpDir(): string {
  const dir = join(
    tmpdir(),
    `troy-msg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("handleToolCall – note tools", () => {
  let dir = "";
  let notesPath = "";

  beforeEach(() => {
    dir = tmpDir();
    notesPath = join(dir, "NOTES.md");
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  });

  it("rewrite_notes creates file with given content", async () => {
    const result = await handleToolCall(
      "rewrite_notes",
      JSON.stringify({ content: "# Notes\n\nhello world\n" }),
      notesPath,
    );
    assert.equal(result, "Done.");
    const content = readFileSync(notesPath, "utf-8");
    assert.equal(content, "# Notes\n\nhello world\n");
  });

  it("rewrite_notes overwrites existing file", async () => {
    writeFileSync(notesPath, "old content\n", "utf-8");
    await handleToolCall(
      "rewrite_notes",
      JSON.stringify({ content: "# Notes\n\nnew content\n" }),
      notesPath,
    );
    const content = readFileSync(notesPath, "utf-8");
    assert.equal(content, "# Notes\n\nnew content\n");
  });

  it("rewrite_notes second call fully replaces first", async () => {
    await handleToolCall(
      "rewrite_notes",
      JSON.stringify({ content: "# Notes\n\nfirst\n" }),
      notesPath,
    );
    await handleToolCall(
      "rewrite_notes",
      JSON.stringify({ content: "# Notes\n\nfirst\nsecond\n" }),
      notesPath,
    );
    const content = readFileSync(notesPath, "utf-8");
    assert.equal(content, "# Notes\n\nfirst\nsecond\n");
  });

  it("edit_note replaces text in existing file", async () => {
    writeFileSync(notesPath, "foo bar baz", "utf-8");
    const result = await handleToolCall(
      "edit_note",
      JSON.stringify({ old_text: "bar", new_text: "qux" }),
      notesPath,
    );
    assert.equal(result, "Done.");
    const content = readFileSync(notesPath, "utf-8");
    assert.equal(content, "foo qux baz");
  });

  it("edit_note deletes text when new_text is empty string", async () => {
    writeFileSync(notesPath, "keep this\ndelete this\nkeep too", "utf-8");
    await handleToolCall(
      "edit_note",
      JSON.stringify({ old_text: "\ndelete this", new_text: "" }),
      notesPath,
    );
    const content = readFileSync(notesPath, "utf-8");
    assert.equal(content, "keep this\nkeep too");
  });

  it("edit_note returns error when old_text is not found", async () => {
    writeFileSync(notesPath, "some content", "utf-8");
    const result = await handleToolCall(
      "edit_note",
      JSON.stringify({ old_text: "not present", new_text: "x" }),
      notesPath,
    );
    assert.equal(result, "Error: old_text not found in NOTES.md.");
  });

  it("edit_note returns error when notes file does not exist", async () => {
    assert.ok(!existsSync(notesPath));
    const result = await handleToolCall(
      "edit_note",
      JSON.stringify({ old_text: "anything", new_text: "x" }),
      notesPath,
    );
    assert.equal(result, "Error: old_text not found in NOTES.md.");
  });

  it("unknown tool returns error message", async () => {
    const result = await handleToolCall("no_such_tool", "{}", notesPath);
    assert.equal(result, 'Error: unknown tool "no_such_tool"');
  });
});
