import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { formatCompletionStatus } from "../src/formatters/CompletionFormatters";

describe("formatCompletionStatus", () => {
  it.each([
    ["SUCCESS", "Success", "info"],
    ["FAILURE", "Failed", "warning"],
    ["FAILED", "Failed", "warning"],
    ["ERROR", "Failed", "warning"],
    ["UNSTABLE", "Unstable", "warning"],
    ["ABORTED", "Aborted", "warning"],
    ["NOT_BUILT", "Not built", "info"],
    [" unstable ", "Unstable", "warning"]
  ])("maps result %s to %s / %s", (result, label, severity) => {
    assert.deepEqual(formatCompletionStatus(result, "red"), { label, severity });
  });

  it.each([
    ["blue", "Success", "info"],
    ["green", "Success", "info"],
    ["red", "Failed", "warning"],
    ["yellow", "Unstable", "warning"],
    ["aborted", "Aborted", "warning"],
    ["notbuilt", "Not built", "info"],
    ["grey", "Not built", "info"],
    ["disabled", "Disabled", "info"],
    ["blue_anime", "Running", "info"],
    ["purple", "Unknown", "info"]
  ])("maps job color %s to %s / %s", (color, label, severity) => {
    assert.deepEqual(formatCompletionStatus(undefined, color), { label, severity });
    assert.deepEqual(formatCompletionStatus("CUSTOM", color), { label, severity });
  });

  it("falls back to Unknown without a usable result or color", () => {
    assert.deepEqual(formatCompletionStatus(undefined, undefined), {
      label: "Unknown",
      severity: "info"
    });
    assert.deepEqual(formatCompletionStatus(42, "  "), { label: "Unknown", severity: "info" });
  });
});
