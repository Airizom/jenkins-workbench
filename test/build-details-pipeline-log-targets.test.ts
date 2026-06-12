import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PipelineLogTargetViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { hasPipelineLogTarget } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineLogTargets";

describe("pipeline log targets", () => {
  it("rejects a restored target that is absent from the current stages", () => {
    const currentTarget = buildTarget("stage:current", "stage");
    const staleTarget = buildTarget("stage:stale", "stage");

    assert.equal(hasPipelineLogTarget([buildStage("current", currentTarget)], staleTarget), false);
  });

  it("finds stage and nested step targets in the current stages", () => {
    const stageTarget = buildTarget("stage:build", "stage");
    const stepTarget = buildTarget("step:archive", "step");
    const stages = [
      buildStage("build", stageTarget, {
        parallelBranches: [
          buildStage("branch", undefined, {
            stepsAll: [buildStep("archive", stepTarget)]
          })
        ]
      })
    ];

    assert.equal(hasPipelineLogTarget(stages, stageTarget), true);
    assert.equal(hasPipelineLogTarget(stages, stepTarget), true);
  });
});

function buildTarget(
  key: string,
  kind: PipelineLogTargetViewModel["kind"]
): PipelineLogTargetViewModel {
  return {
    key,
    kind,
    name: key,
    nodeId: key
  };
}

function buildStage(
  key: string,
  logTarget?: PipelineLogTargetViewModel,
  overrides: Partial<PipelineStageViewModel> = {}
): PipelineStageViewModel {
  return {
    key,
    nodeId: key,
    logTarget,
    name: key,
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1 sec",
    canRestartFromStage: false,
    hasSteps: false,
    stepsFailedOnly: [],
    stepsAll: [],
    parallelBranches: [],
    canOpenLog: Boolean(logTarget),
    ...overrides
  };
}

function buildStep(
  key: string,
  logTarget?: PipelineLogTargetViewModel
): PipelineStageStepViewModel {
  return {
    key,
    nodeId: key,
    logTarget,
    name: key,
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1 sec",
    canOpenLog: Boolean(logTarget)
  };
}
