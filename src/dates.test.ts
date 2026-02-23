import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weekContext, computeDateRange } from "./dates.js";

describe("weekContext", () => {
  it("returns correct week boundaries for a Monday", () => {
    const monday = new Date(2026, 1, 23); // Mon 2026-02-23
    const ctx = weekContext(monday);
    assert.ok(ctx.includes("Monday, 2026-02-23"));
    assert.ok(ctx.includes("Monday 2026-02-23 to Sunday 2026-03-01"));
    assert.ok(ctx.includes("Monday 2026-03-02 to Sunday 2026-03-08"));
  });

  it("returns correct week boundaries for a Wednesday", () => {
    const wed = new Date(2026, 1, 25); // Wed 2026-02-25
    const ctx = weekContext(wed);
    assert.ok(ctx.includes("Wednesday, 2026-02-25"));
    // Week still starts on the preceding Monday
    assert.ok(ctx.includes("Monday 2026-02-23 to Sunday 2026-03-01"));
  });

  it("returns correct week boundaries for a Sunday", () => {
    const sun = new Date(2026, 2, 1); // Sun 2026-03-01
    const ctx = weekContext(sun);
    assert.ok(ctx.includes("Sunday, 2026-03-01"));
    // Sunday belongs to the Mon-Sun week that started Feb 23
    assert.ok(ctx.includes("Monday 2026-02-23 to Sunday 2026-03-01"));
    assert.ok(ctx.includes("Monday 2026-03-02 to Sunday 2026-03-08"));
  });

  it("handles year boundary", () => {
    const wed = new Date(2025, 11, 31); // Wed 2025-12-31
    const ctx = weekContext(wed);
    assert.ok(ctx.includes("Wednesday, 2025-12-31"));
    assert.ok(ctx.includes("Monday 2025-12-29 to Sunday 2026-01-04"));
    assert.ok(ctx.includes("Monday 2026-01-05 to Sunday 2026-01-11"));
  });
});

describe("computeDateRange", () => {
  it("returns today for period 'today'", () => {
    const range = computeDateRange({ period: "today" });
    assert.equal(range.start, range.end);
  });

  it("returns 7-day week for 'this_week'", () => {
    const range = computeDateRange({ period: "this_week" });
    const start = new Date(range.start);
    const end = new Date(range.end);
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    assert.equal(diff, 6); // Mon to Sun = 6 day difference
    assert.equal(start.getDay(), 1); // Monday
    assert.equal(end.getDay(), 0); // Sunday
  });

  it("returns 7-day week for 'next_week'", () => {
    const range = computeDateRange({ period: "next_week" });
    const start = new Date(range.start);
    const end = new Date(range.end);
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    assert.equal(diff, 6);
    assert.equal(start.getDay(), 1);
    assert.equal(end.getDay(), 0);
  });

  it("computes range from explicit start + offset", () => {
    const range = computeDateRange({
      start: "2026-03-01",
      offset_days: 10,
    });
    assert.equal(range.start, "2026-03-01");
    assert.equal(range.end, "2026-03-11");
  });

  it("returns next 14 days for 'next_14_days'", () => {
    const range = computeDateRange({ period: "next_14_days" });
    const start = new Date(range.start);
    const end = new Date(range.end);
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    assert.equal(diff, 13);
  });
});
