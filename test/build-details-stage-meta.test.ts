import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PipelineStageViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  describeStageMeta,
  isStageNotRun
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/StageNode";

function stage(overrides: Partial<PipelineStageViewModel> = {}): PipelineStageViewModel {
  return {
    key: "stage",
    name: "Build",
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "48s",
    durationMs: 48_000,
    canRestartFromStage: false,
    hasSteps: false,
    stepsAll: [],
    stepsFailedOnly: [],
    parallelBranches: [],
    canOpenLog: false,
    ...overrides
  };
}

describe("pipeline stage meta", () => {
  it("shows the duration for stages that ran", () => {
    assert.equal(isStageNotRun(stage()), false);
    assert.equal(describeStageMeta(stage()), "48s");
    assert.equal(describeStageMeta(stage({ durationLabel: "" })), "Unknown");
  });

  it("labels skipped zero-duration stages as not run instead of 0ms", () => {
    const skipped = stage({
      statusClass: "neutral",
      statusLabel: "Skipped",
      durationLabel: "0ms",
      durationMs: 0
    });
    assert.equal(isStageNotRun(skipped), true);
    assert.equal(describeStageMeta(skipped), "Did not run");
    assert.equal(isStageNotRun(stage({ statusClass: "neutral", durationMs: undefined })), false);
  });

  it("counts parallel branches", () => {
    assert.equal(
      describeStageMeta(stage({ parallelBranches: [stage({ key: "a" })] })),
      "48s · 1 parallel branch"
    );
    assert.equal(
      describeStageMeta(stage({ parallelBranches: [stage({ key: "a" }), stage({ key: "b" })] })),
      "48s · 2 parallel branches"
    );
  });
});
