import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatRelativeDate } from "../src/formatters/RelativeTimeFormatters";

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
