import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  formatLocaleTimestampWithRelative,
  formatOptionalLocaleTimestamp
} from "../src/formatters/DisplayFormatters";

describe("display formatters", () => {
  it("returns an empty timestamp for non-finite values", () => {
    for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatOptionalLocaleTimestamp(timestamp), "");
      assert.equal(formatLocaleTimestampWithRelative(timestamp, false), "");
      assert.equal(formatLocaleTimestampWithRelative(timestamp, true), "");
    }
  });

  it("preserves locale and relative formatting for finite timestamps", () => {
    const timestamp = Date.now();
    const absolute = new Date(timestamp).toLocaleString();

    assert.equal(formatLocaleTimestampWithRelative(timestamp, false), absolute);
    assert.equal(formatLocaleTimestampWithRelative(timestamp, true), `${absolute} (just now)`);
  });
});
