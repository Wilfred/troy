import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTablesForDiscord } from "./discordformat.js";

describe("formatTablesForDiscord", () => {
  it("leaves text without tables unchanged", () => {
    const text = "Hello world\nNo tables here.";
    assert.equal(formatTablesForDiscord(text), text);
  });

  it("converts a simple markdown table to a code block", () => {
    const input = [
      "| Name  | Age |",
      "| ----- | --- |",
      "| Alice | 30  |",
      "| Bob   | 25  |",
    ].join("\n");

    const expected = [
      "```",
      "Name   Age",
      "-----  ---",
      "Alice  30",
      "Bob    25",
      "```",
    ].join("\n");

    assert.equal(formatTablesForDiscord(input), expected);
  });

  it("preserves text before and after a table", () => {
    const input = [
      "Here is a table:",
      "",
      "| X | Y |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "That was the table.",
    ].join("\n");

    const result = formatTablesForDiscord(input);
    assert.ok(result.startsWith("Here is a table:\n\n```\n"));
    assert.ok(result.endsWith("```\n\nThat was the table."));
  });

  it("handles multiple tables in the same text", () => {
    const input = [
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "Middle text",
      "",
      "| C | D |",
      "|---|---|",
      "| 3 | 4 |",
    ].join("\n");

    const result = formatTablesForDiscord(input);
    const codeBlocks = result.match(/```/g);
    assert.equal(codeBlocks?.length, 4); // 2 opening + 2 closing
  });

  it("aligns columns based on widest cell", () => {
    const input = [
      "| Short | LongerHeader |",
      "|-------|--------------|",
      "| x     | y            |",
    ].join("\n");

    const result = formatTablesForDiscord(input);
    assert.ok(result.includes("Short  LongerHeader"));
    assert.ok(result.includes("x      y"));
  });

  it("handles a table with no data rows", () => {
    const input = ["| H1 | H2 |", "|----|-----|"].join("\n");

    const result = formatTablesForDiscord(input);
    assert.ok(result.includes("```"));
    assert.ok(result.includes("H1  H2"));
  });
});
