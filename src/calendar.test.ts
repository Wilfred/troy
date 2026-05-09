import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatDateWithDay,
  isExternalInvite,
  toApiTimeBound,
} from "./calendar.js";

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

  it("returns an unparsable string unchanged", () => {
    assert.equal(formatDateWithDay("Unknown"), "Unknown");
  });
});

describe("toApiTimeBound", () => {
  it("normalizes a date-only string to start-of-day UTC instant", () => {
    // 2026-05-09 is summer (BST = UTC+1), so 00:00 BST = 23:00 UTC the day before
    assert.equal(toApiTimeBound("2026-05-09"), "2026-05-08T23:00:00.000Z");
  });

  it("normalizes a naive datetime to a UTC instant in the local timezone", () => {
    // 2026-05-09T23:59:59 BST = 22:59:59 UTC
    assert.equal(
      toApiTimeBound("2026-05-09T23:59:59"),
      "2026-05-09T22:59:59.000Z",
    );
  });

  it("preserves a datetime that already has a Z offset", () => {
    assert.equal(
      toApiTimeBound("2026-05-09T12:00:00Z"),
      "2026-05-09T12:00:00.000Z",
    );
  });

  it("preserves a datetime with an explicit offset", () => {
    assert.equal(
      toApiTimeBound("2026-05-09T12:00:00+02:00"),
      "2026-05-09T10:00:00.000Z",
    );
  });

  it("throws on an unparsable value", () => {
    assert.throws(() => toApiTimeBound("not a date"));
  });
});

describe("isExternalInvite", () => {
  it("returns false when there is no organizer", () => {
    assert.equal(isExternalInvite({}), false);
  });

  it("returns false when organizer.self is true", () => {
    assert.equal(
      isExternalInvite({ organizer: { self: true, email: "me@example.com" } }),
      false,
    );
  });

  it("returns true when organizer exists but self is not true", () => {
    assert.equal(
      isExternalInvite({
        organizer: { self: false, email: "attacker@example.com" },
      }),
      true,
    );
  });

  it("returns true when organizer exists with no self field", () => {
    assert.equal(
      isExternalInvite({ organizer: { email: "someone@example.com" } }),
      true,
    );
  });
});
