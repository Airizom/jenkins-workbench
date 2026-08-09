import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PipelineRun } from "../src/jenkins/pipeline/PipelineTypes";
import { BuildDetailsPanelState } from "../src/panels/buildDetails/BuildDetailsPanelState";
import { buildPipelineStagesViewModel } from "../src/panels/buildDetails/BuildDetailsPipelineViewModel";

describe("build details restart stage identifiers", () => {
  it("preserves distinct nonblank identifiers in panel state", () => {
    const state = new BuildDetailsPanelState();

    state.setPipelineRestartInfo(true, ["Build", " Build ", "Build", "   "], "supported");

    assert.deepEqual(state.pipelineRestartableStages, ["Build", " Build "]);
  });

  it("matches restartable pipeline stages by their exact identifier", () => {
    const pipelineRun: PipelineRun = {
      stages: [createStage("Build", "build"), createStage(" Build ", "spaced-build")]
    };

    const stages = buildPipelineStagesViewModel(pipelineRun, {
      details: {
        number: 15,
        url: "https://jenkins.example.com/job/demo/15/",
        building: false,
        result: "FAILURE"
      },
      restartEnabled: true,
      restartableStages: [" Build "]
    });

    assert.equal(stages[0]?.canRestartFromStage, false);
    assert.equal(stages[1]?.canRestartFromStage, true);
    assert.equal(stages[1]?.name, " Build ");
  });
});

function createStage(name: string, key: string): PipelineRun["stages"][number] {
  return {
    key,
    name,
    steps: [],
    parallelBranches: []
  };
}
