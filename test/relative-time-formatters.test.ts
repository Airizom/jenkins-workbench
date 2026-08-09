import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import {
  formatRelativeDate,
  formatRelativeIsoTimestamp,
  formatRelativeTimestampMs
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

  it("preserves Date formatting at elapsed-time boundaries", () => {
    const cases: Array<[number, string]> = [
      [MINUTE_MS, "1m ago"],
      [HOUR_MS, "1h ago"],
      [DAY_MS, "24h ago"],
      [2 * DAY_MS, "2d ago"],
      [7 * DAY_MS, "7d ago"]
    ];

    for (const [ageMs, expected] of cases) {
      assert.equal(formatRelativeDate(new Date(NOW - ageMs), NOW), expected);
    }
  });

  it("preserves ISO formatting at elapsed-time boundaries", () => {
    const ages = [MINUTE_MS, HOUR_MS, DAY_MS, 2 * DAY_MS, 7 * DAY_MS];

    for (const ageMs of ages) {
      const timestamp = NOW - ageMs;
      const expected = ageMs < HOUR_MS ? "1m ago" : new Date(timestamp).toLocaleTimeString();
      assert.equal(formatRelativeIsoTimestamp(new Date(timestamp).toISOString()), expected);
    }
  });
});

describe("formatRelativeDate", () => {
  it("keeps sub-minute ages as Just now", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    assert.equal(formatRelativeDate(new Date(now - 15_000), now), "Just now");
    assert.equal(formatRelativeDate(new Date(now - 59_999), now), "Just now");
  });

  it("formats one minute old timestamps as minutes", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    assert.equal(formatRelativeDate(new Date(now - 60_000), now), "1m ago");
  });
});
