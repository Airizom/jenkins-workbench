import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PipelineStageViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  buildStageStripSegments,
  countFailedSegments,
  describeSegmentAria,
  describeSegmentDetail,
  isDenseStrip
} from "../src/panels/buildDetails/webview/components/buildDetails/stageStrip/stageStripModel";

function makeStage(overrides: Partial<PipelineStageViewModel> = {}): PipelineStageViewModel {
  return {
    key: "stage-1",
    name: "Build",
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "12s",
    canRestartFromStage: false,
    hasSteps: false,
    stepsFailedOnly: [],
    stepsAll: [],
    parallelBranches: [],
    canOpenLog: false,
    ...overrides
  };
}

describe("stageStripModel", () => {
  it("maps top-level stages to segments in order", () => {
    const segments = buildStageStripSegments([
      makeStage({ key: "a", name: "Checkout" }),
      makeStage({ key: "b", name: "Build", statusClass: "running", statusLabel: "Running" }),
      makeStage({ key: "c", name: "Deploy", statusClass: "neutral", statusLabel: "Skipped" })
    ]);

    assert.deepEqual(
      segments.map((segment) => segment.key),
      ["a", "b", "c"]
    );
    assert.deepEqual(
      segments.map((segment) => segment.statusClass),
      ["success", "running", "neutral"]
    );
    assert.equal(segments[1]?.statusLabel, "Running");
    assert.equal(segments[0]?.durationLabel, "12s");
  });

  it("escalates a success parent when a nested branch ended worse", () => {
    const segments = buildStageStripSegments([
      makeStage({
        key: "parallel",
        statusClass: "success",
        parallelBranches: [
          makeStage({ key: "branch-ok" }),
          makeStage({
            key: "branch-nested",
            parallelBranches: [
              makeStage({ key: "deep-fail", statusClass: "failure", statusLabel: "Failed" })
            ]
          })
        ]
      })
    ]);

    assert.equal(segments[0]?.statusClass, "failure");
    assert.equal(segments[0]?.statusLabel, "Failed");
  });

  it("does not downgrade a parent that already reports a worse status", () => {
    const segments = buildStageStripSegments([
      makeStage({
        key: "parallel",
        statusClass: "failure",
        parallelBranches: [makeStage({ key: "branch-ok", statusClass: "success" })]
      })
    ]);

    assert.equal(segments[0]?.statusClass, "failure");
  });

  it("prefers failure over unstable when escalating", () => {
    const segments = buildStageStripSegments([
      makeStage({
        key: "parallel",
        statusClass: "neutral",
        parallelBranches: [
          makeStage({ key: "branch-unstable", statusClass: "unstable" }),
          makeStage({ key: "branch-failed", statusClass: "failure" })
        ]
      })
    ]);

    assert.equal(segments[0]?.statusClass, "failure");
  });

  it("counts nested parallel branches", () => {
    const segments = buildStageStripSegments([
      makeStage({
        key: "parallel",
        parallelBranches: [
          makeStage({ key: "b1" }),
          makeStage({
            key: "b2",
            parallelBranches: [makeStage({ key: "b2a" }), makeStage({ key: "b2b" })]
          })
        ]
      }),
      makeStage({ key: "plain" })
    ]);

    assert.equal(segments[0]?.branchCount, 4);
    assert.equal(segments[1]?.branchCount, 0);
  });

  it("treats unknown status classes as neutral severity", () => {
    const segments = buildStageStripSegments([
      makeStage({
        key: "parallel",
        statusClass: "success",
        parallelBranches: [makeStage({ key: "weird", statusClass: "bogus-status" })]
      })
    ]);

    assert.equal(segments[0]?.statusClass, "success");
  });

  it("flags dense strips above ten segments", () => {
    assert.equal(isDenseStrip(10), false);
    assert.equal(isDenseStrip(11), true);
    assert.equal(isDenseStrip(0), false);
  });

  it("describes segments for aria labels and tooltips", () => {
    const [plain, parallel] = buildStageStripSegments([
      makeStage({ key: "a", name: "Checkout", statusLabel: "Success", durationLabel: "12s" }),
      makeStage({
        key: "b",
        name: "Test",
        statusLabel: "Failed",
        statusClass: "failure",
        durationLabel: "—",
        parallelBranches: [makeStage({ key: "b1" })]
      })
    ]);

    assert.ok(plain && parallel);
    assert.equal(describeSegmentAria(plain), "Checkout: Success");
    assert.equal(describeSegmentDetail(plain), "Success · 12s");
    assert.equal(describeSegmentAria(parallel), "Test: Failed, 1 parallel branch");
    assert.equal(describeSegmentDetail(parallel), "Failed · 1 parallel branch");
  });

  it("counts failed segments", () => {
    const segments = buildStageStripSegments([
      makeStage({ key: "a", statusClass: "failure" }),
      makeStage({ key: "b" }),
      makeStage({ key: "c", statusClass: "failure" }),
      makeStage({ key: "d", statusClass: "unstable" })
    ]);

    assert.equal(countFailedSegments(segments), 2);
  });
});
