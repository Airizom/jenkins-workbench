import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  formatRelativeTimestampMs,
  formatUpdatedAtLabel
} from "../src/formatters/RelativeTimeFormatters";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

describe("relative time formatters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves timestamp formatting at elapsed-time boundaries", () => {
    const cases: Array<[number, string]> = [
      [MINUTE_MS, "1m ago"],
      [HOUR_MS, "1h ago"],
      [DAY_MS, "yesterday"],
      [2 * DAY_MS, "2 days ago"],
      [7 * DAY_MS, new Date(NOW - 7 * DAY_MS).toLocaleDateString()]
    ];

    for (const [ageMs, expected] of cases) {
      assert.equal(formatRelativeTimestampMs(NOW - ageMs), expected);
    }
  });
});

describe("formatUpdatedAtLabel", () => {
  it("uses one Updated pattern for Date and ISO inputs", () => {
    const cases: Array<[number, string]> = [
      [15_000, "Updated just now"],
      [59_999, "Updated just now"],
      [MINUTE_MS, "Updated 1m ago"],
      [59 * MINUTE_MS, "Updated 59m ago"],
      [HOUR_MS, "Updated 1h ago"],
      [23 * HOUR_MS, "Updated 23h ago"]
    ];

    for (const [ageMs, expected] of cases) {
      assert.equal(formatUpdatedAtLabel(new Date(NOW - ageMs), NOW), expected);
      assert.equal(formatUpdatedAtLabel(new Date(NOW - ageMs).toISOString(), NOW), expected);
    }
  });

  it("includes the date once the snapshot is a day old", () => {
    const timestamp = NOW - 2 * DAY_MS;
    const expected = new Date(timestamp).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });

    assert.equal(formatUpdatedAtLabel(new Date(timestamp), NOW), `Updated ${expected}`);
    assert.equal(formatUpdatedAtLabel(new Date(NOW - DAY_MS), NOW).startsWith("Updated "), true);
    assert.notEqual(formatUpdatedAtLabel(new Date(NOW - DAY_MS), NOW), "Updated 24h ago");
  });

  it("reports unknown times without a misleading relative label", () => {
    assert.equal(formatUpdatedAtLabel(undefined, NOW), "Update time unknown");
    assert.equal(formatUpdatedAtLabel("not a date", NOW), "Update time unknown");
  });
});
