import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatToolList,
  handleToolCall,
  TRUSTED_TOOLS,
  UNTRUSTED_TOOLS,
} from "./tools.js";

function makeDataDir(): {
  dataDir: string;
  notesPath: string;
  skillsDir: string;
} {
  const dataDir = mkdtempSync(join(tmpdir(), "troy-skill-test-"));
  mkdirSync(join(dataDir, "rules"));
  mkdirSync(join(dataDir, "skills"));
  const notesPath = join(dataDir, "rules", "NOTES.md");
  writeFileSync(notesPath, "", "utf-8");
  return { dataDir, notesPath, skillsDir: join(dataDir, "skills") };
}

describe("formatToolList", () => {
  it("includes every trusted tool", () => {
    const result = formatToolList();
    for (const tool of TRUSTED_TOOLS) {
      assert.ok(
        result.includes(tool.function.name),
        `Missing trusted tool: ${tool.function.name}`,
      );
    }
  });

  it("includes every untrusted tool", () => {
    const result = formatToolList();
    for (const tool of UNTRUSTED_TOOLS) {
      assert.ok(
        result.includes(tool.function.name),
        `Missing untrusted tool: ${tool.function.name}`,
      );
    }
  });

  it("labels trusted-only tools as trusted", () => {
    const untrustedNames = new Set(UNTRUSTED_TOOLS.map((t) => t.function.name));
    const trustedOnly = TRUSTED_TOOLS.find(
      (t) => !untrustedNames.has(t.function.name),
    );
    assert.ok(trustedOnly, "Expected at least one trusted-only tool");

    const result = formatToolList();
    assert.ok(
      result.includes(`**${trustedOnly.function.name}** (trusted)`),
      `${trustedOnly.function.name} should be labelled as trusted`,
    );
  });

  it("labels untrusted-only tools as untrusted", () => {
    const trustedNames = new Set(TRUSTED_TOOLS.map((t) => t.function.name));
    const untrustedOnly = UNTRUSTED_TOOLS.find(
      (t) => !trustedNames.has(t.function.name),
    );
    assert.ok(untrustedOnly, "Expected at least one untrusted-only tool");

    const result = formatToolList();
    assert.ok(
      result.includes(`**${untrustedOnly.function.name}** (untrusted)`),
      `${untrustedOnly.function.name} should be labelled as untrusted`,
    );
  });

  it("labels tools in both lists as trusted + untrusted", () => {
    const trustedNames = new Set(TRUSTED_TOOLS.map((t) => t.function.name));
    const both = UNTRUSTED_TOOLS.find((t) => trustedNames.has(t.function.name));
    assert.ok(both, "Expected at least one tool in both lists");

    const result = formatToolList();
    assert.ok(
      result.includes(`**${both.function.name}** (trusted + untrusted)`),
      `${both.function.name} should be labelled as trusted + untrusted`,
    );
  });

  it("does not duplicate tools that appear in both lists", () => {
    const result = formatToolList();
    const lines = result.split("\n");
    const names = lines.map((l) => l.match(/\*\*(.+?)\*\*/)?.[1]);
    const unique = new Set(names);
    assert.equal(names.length, unique.size, "Tool names should be unique");
  });
});

describe("skill tools", () => {
  it("read_skill returns the raw file contents", async () => {
    const { notesPath, skillsDir } = makeDataDir();
    const content = "---\ndescription: testing\n---\nhello body\n";
    writeFileSync(join(skillsDir, "foo.md"), content, "utf-8");

    const result = await handleToolCall(
      "read_skill",
      JSON.stringify({ filename: "foo.md" }),
      notesPath,
    );
    assert.equal(result, content);
  });

  it("read_skill reports a missing file", async () => {
    const { notesPath } = makeDataDir();
    const result = await handleToolCall(
      "read_skill",
      JSON.stringify({ filename: "missing.md" }),
      notesPath,
    );
    assert.match(result, /not found/);
  });

  it("edit_skill replaces text in the skill file", async () => {
    const { notesPath, skillsDir } = makeDataDir();
    const original = "---\ndescription: old desc\n---\nkeep me\n";
    writeFileSync(join(skillsDir, "foo.md"), original, "utf-8");

    const result = await handleToolCall(
      "edit_skill",
      JSON.stringify({
        filename: "foo.md",
        old_text: "old desc",
        new_text: "new desc",
      }),
      notesPath,
    );
    assert.equal(result, "Done.");
    const updated = readFileSync(join(skillsDir, "foo.md"), "utf-8");
    assert.equal(updated, "---\ndescription: new desc\n---\nkeep me\n");
  });

  it("create_skill writes a new skill with front matter", async () => {
    const { notesPath, skillsDir } = makeDataDir();

    const result = await handleToolCall(
      "create_skill",
      JSON.stringify({
        filename: "cooking.md",
        description: "how to cook",
        body: "# Cooking\n\nStep 1: boil water.\n",
      }),
      notesPath,
    );
    assert.equal(result, "Done.");
    const written = readFileSync(join(skillsDir, "cooking.md"), "utf-8");
    assert.equal(
      written,
      "---\ndescription: how to cook\n---\n# Cooking\n\nStep 1: boil water.\n",
    );
  });

  it("create_skill refuses a filename without .md extension", async () => {
    const { notesPath } = makeDataDir();
    const result = await handleToolCall(
      "create_skill",
      JSON.stringify({
        filename: "cooking",
        description: "d",
        body: "b",
      }),
      notesPath,
    );
    assert.match(result, /must end with \.md/);
  });

  it("create_skill refuses to overwrite an existing skill", async () => {
    const { notesPath, skillsDir } = makeDataDir();
    const original = "---\ndescription: original\n---\nbody\n";
    writeFileSync(join(skillsDir, "foo.md"), original, "utf-8");

    const result = await handleToolCall(
      "create_skill",
      JSON.stringify({
        filename: "foo.md",
        description: "new",
        body: "new body",
      }),
      notesPath,
    );
    assert.match(result, /already exists/);
    const unchanged = readFileSync(join(skillsDir, "foo.md"), "utf-8");
    assert.equal(unchanged, original);
  });

  it("edit_skill reports when old_text is not found", async () => {
    const { notesPath, skillsDir } = makeDataDir();
    writeFileSync(
      join(skillsDir, "foo.md"),
      "---\ndescription: d\n---\nbody\n",
      "utf-8",
    );

    const result = await handleToolCall(
      "edit_skill",
      JSON.stringify({
        filename: "foo.md",
        old_text: "nope",
        new_text: "x",
      }),
      notesPath,
    );
    assert.match(result, /not found/);
  });
});
