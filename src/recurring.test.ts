import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesCron, validateCron } from "./recurring.js";

describe("validateCron", () => {
  it("accepts valid expressions", () => {
    assert.equal(validateCron("0 9 * * 1"), null);
    assert.equal(validateCron("30 7 * * *"), null);
    assert.equal(validateCron("0 9 1 * *"), null);
    assert.equal(validateCron("*/15 * * * *"), null);
    assert.equal(validateCron("0 9 * * 1-5"), null);
    assert.equal(validateCron("0 9,18 * * *"), null);
  });

  it("rejects wrong number of fields", () => {
    assert.ok(validateCron("0 9 *") !== null);
    assert.ok(validateCron("0 9 * * * *") !== null);
    assert.ok(validateCron("") !== null);
  });

  it("rejects out-of-range values", () => {
    assert.ok(validateCron("60 9 * * *") !== null);
    assert.ok(validateCron("0 25 * * *") !== null);
    assert.ok(validateCron("0 9 32 * *") !== null);
    assert.ok(validateCron("0 9 * 13 *") !== null);
    assert.ok(validateCron("0 9 * * 7") !== null);
  });

  it("rejects invalid range", () => {
    assert.ok(validateCron("0 9 * * 5-2") !== null);
  });
});

describe("matchesCron", () => {
  it("matches every-minute wildcard", () => {
    const date = new Date(2026, 2, 31, 10, 30); // Tue Mar 31 10:30
    assert.ok(matchesCron("* * * * *", date));
  });

  it("matches specific time", () => {
    const date = new Date(2026, 2, 31, 9, 0); // Tue Mar 31 09:00
    assert.ok(matchesCron("0 9 * * *", date));
  });

  it("does not match wrong time", () => {
    const date = new Date(2026, 2, 31, 10, 0); // Tue Mar 31 10:00
    assert.ok(!matchesCron("0 9 * * *", date));
  });

  it("matches day of week (Monday=1)", () => {
    const monday = new Date(2026, 2, 30, 9, 0); // Mon Mar 30 09:00
    assert.ok(matchesCron("0 9 * * 1", monday));

    const tuesday = new Date(2026, 2, 31, 9, 0); // Tue Mar 31 09:00
    assert.ok(!matchesCron("0 9 * * 1", tuesday));
  });

  it("matches day-of-week range (weekdays)", () => {
    const monday = new Date(2026, 2, 30, 9, 0);
    const saturday = new Date(2026, 3, 4, 9, 0); // Sat Apr 4 09:00
    assert.ok(matchesCron("0 9 * * 1-5", monday));
    assert.ok(!matchesCron("0 9 * * 1-5", saturday));
  });

  it("matches step syntax", () => {
    const at0 = new Date(2026, 2, 31, 10, 0);
    const at15 = new Date(2026, 2, 31, 10, 15);
    const at7 = new Date(2026, 2, 31, 10, 7);
    assert.ok(matchesCron("*/15 * * * *", at0));
    assert.ok(matchesCron("*/15 * * * *", at15));
    assert.ok(!matchesCron("*/15 * * * *", at7));
  });

  it("matches comma-separated values", () => {
    const at9 = new Date(2026, 2, 31, 9, 0);
    const at18 = new Date(2026, 2, 31, 18, 0);
    const at12 = new Date(2026, 2, 31, 12, 0);
    assert.ok(matchesCron("0 9,18 * * *", at9));
    assert.ok(matchesCron("0 9,18 * * *", at18));
    assert.ok(!matchesCron("0 9,18 * * *", at12));
  });

  it("matches specific day of month", () => {
    const first = new Date(2026, 3, 1, 9, 0); // Apr 1 09:00
    const second = new Date(2026, 3, 2, 9, 0); // Apr 2 09:00
    assert.ok(matchesCron("0 9 1 * *", first));
    assert.ok(!matchesCron("0 9 1 * *", second));
  });

  it("rejects invalid expression", () => {
    assert.ok(!matchesCron("bad", new Date()));
  });
});
