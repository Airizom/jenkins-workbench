import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { PipelineStageViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { buildPipelineGraphModel } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineGraph/pipelineGraphModel";

function makeStage(
  key: string,
  parallelBranches: PipelineStageViewModel[] = []
): PipelineStageViewModel {
  return {
    key,
    name: key,
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1s",
    durationMs: 1000,
    canRestartFromStage: false,
    hasSteps: false,
    stepsFailedOnly: [],
    stepsAll: [],
    parallelBranches,
    canOpenLog: false
  };
}

describe("pipelineGraphModel", () => {
  it("calculates duration normalization bounds once for all nodes", () => {
    const stages = Array.from({ length: 8 }, (_, index) => ({
      ...makeStage(`stage-${index}`),
      durationMs: (index + 1) * 1000
    }));
    const logSpy = vi.spyOn(Math, "log");

    try {
      buildPipelineGraphModel(stages);

      assert.ok(logSpy.mock.calls.length <= stages.length * 2);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("keeps topology distinct when graph geometry is unchanged", () => {
    const sequentialAfterSingleBranch = buildPipelineGraphModel([
      makeStage("a", [makeStage("b")]),
      makeStage("c")
    ]);
    const twoParallelBranches = buildPipelineGraphModel([
      makeStage("a", [makeStage("b"), makeStage("c")])
    ]);

    assert.equal(sequentialAfterSingleBranch.geometryKey, twoParallelBranches.geometryKey);
    assert.notEqual(sequentialAfterSingleBranch.topologyKey, twoParallelBranches.topologyKey);
  });
});
