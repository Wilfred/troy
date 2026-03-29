import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatToolList, TRUSTED_TOOLS, UNTRUSTED_TOOLS } from "./tools.js";

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
