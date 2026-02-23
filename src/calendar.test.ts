import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDateWithDay } from "./calendar.js";

describe("formatDateWithDay", () => {
  it("formats a date-only string with the weekday", () => {
    assert.equal(formatDateWithDay("2026-02-23"), "Monday, 2026-02-23");
  });

  it("formats a datetime string with the weekday and time (whole hour)", () => {
    // 2026-02-23 is winter (GMT = UTC), so 11:00Z is 11am London time
    assert.equal(
      formatDateWithDay("2026-02-23T11:00:00Z"),
      "Monday, 2026-02-23 at 11am",
    );
  });

  it("formats a datetime string with minutes when non-zero", () => {
    assert.equal(
      formatDateWithDay("2026-02-23T11:30:00Z"),
      "Monday, 2026-02-23 at 11:30am",
    );
  });

  it("converts summer datetime to BST (UTC+1)", () => {
    // 2026-07-04 is a Saturday; 10:00Z = 11am BST
    assert.equal(
      formatDateWithDay("2026-07-04T10:00:00Z"),
      "Saturday, 2026-07-04 at 11am",
    );
  });

  it("returns an unparseable string unchanged", () => {
    assert.equal(formatDateWithDay("Unknown"), "Unknown");
  });
});
