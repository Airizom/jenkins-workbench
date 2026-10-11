import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { normalizePipelineStatus } from "../src/formatters/BuildStatusFormatters";

describe("normalizePipelineStatus", () => {
  it.each([
    ["FAILURE", "Failed", "failure", true],
    ["FAILED", "Failed", "failure", true],
    ["ERROR", "Failed", "failure", true],
    ["UNSTABLE", "Unstable", "unstable", true],
    ["ABORTED", "Aborted", "aborted", true],
    ["SUCCESS", "Success", "success", false],
    ["NOT_BUILT", "Not built", "neutral", false],
    ["IN_PROGRESS", "Running", "running", false],
    ["RUNNING", "Running", "running", false],
    ["PAUSED", "Paused", "running", false],
    ["QUEUED", "Queued", "running", false],
    ["SKIPPED", "Skipped", "neutral", false],
    ["custom_status", "Custom Status", "neutral", false],
    [undefined, "Unknown", "neutral", false],
    ["  ", "Unknown", "neutral", false],
    [" failed ", "Failed", "failure", true]
  ])("normalizes %s", (status, label, className, isFailed) => {
    assert.deepEqual(normalizePipelineStatus(status), { label, className, isFailed });
  });
});
