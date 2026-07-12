import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  derivePipelineSectionView,
  findStageByKey,
  findStageLogTarget,
  isPipelinePresentation,
  planRestoredLogTarget,
  resolvePersistedPipelineLogTarget
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineSectionModel";

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

function makeTarget(
  overrides: Partial<PipelineLogTargetViewModel> = {}
): PipelineLogTargetViewModel {
  return {
    key: "stage-1",
    kind: "stage",
    name: "Build",
    nodeId: "10",
    ...overrides
  };
}

describe("derivePipelineSectionView", () => {
  it("hides the section when not loading and there are no stages", () => {
    const view = derivePipelineSectionView(false, 0, "list");
    assert.equal(view.hidden, true);
    assert.equal(view.hasStages, false);
    assert.equal(view.canValidateLogTarget, true);
    assert.equal(view.showLoadingBanner, false);
  });

  it("shows the placeholder body while loading without stages", () => {
    const view = derivePipelineSectionView(true, 0, "graph");
    assert.equal(view.hidden, false);
    assert.equal(view.body, "placeholder");
    assert.equal(view.canValidateLogTarget, false);
    assert.equal(view.showLoadingBanner, false);
  });

  it("shows the loading banner while loading with stages", () => {
    const view = derivePipelineSectionView(true, 2, "list");
    assert.equal(view.hidden, false);
    assert.equal(view.hasStages, true);
    assert.equal(view.showLoadingBanner, true);
    assert.equal(view.canValidateLogTarget, true);
    assert.equal(view.body, "list");
  });

  it("renders the graph body when the graph presentation is selected", () => {
    const view = derivePipelineSectionView(false, 1, "graph");
    assert.equal(view.hidden, false);
    assert.equal(view.body, "graph");
  });

  it("renders the list body when the list presentation is selected", () => {
    const view = derivePipelineSectionView(false, 1, "list");
    assert.equal(view.body, "list");
  });
});

describe("isPipelinePresentation", () => {
  it("accepts graph and list", () => {
    assert.equal(isPipelinePresentation("graph"), true);
    assert.equal(isPipelinePresentation("list"), true);
  });

  it("rejects other values", () => {
    assert.equal(isPipelinePresentation(""), false);
    assert.equal(isPipelinePresentation("table"), false);
    assert.equal(isPipelinePresentation(undefined), false);
  });
});

describe("resolvePersistedPipelineLogTarget", () => {
  it("keeps the current target when validation is not possible yet", () => {
    const currentTarget = makeTarget();
    const resolved = resolvePersistedPipelineLogTarget({
      currentTarget,
      restoredTarget: undefined,
      canValidateLogTarget: false,
      stages: []
    });
    assert.equal(resolved, currentTarget);
  });

  it("keeps the current target when it exists in the stages", () => {
    const currentTarget = makeTarget();
    const resolved = resolvePersistedPipelineLogTarget({
      currentTarget,
      restoredTarget: undefined,
      canValidateLogTarget: true,
      stages: [makeStage({ logTarget: makeTarget() })]
    });
    assert.equal(resolved, currentTarget);
  });

  it("drops a current target that is missing from the stages", () => {
    const resolved = resolvePersistedPipelineLogTarget({
      currentTarget: makeTarget({ key: "missing" }),
      restoredTarget: makeTarget(),
      canValidateLogTarget: true,
      stages: [makeStage({ logTarget: makeTarget() })]
    });
    assert.equal(resolved, undefined);
  });

  it("falls back to the restored target while validation is not possible", () => {
    const restoredTarget = makeTarget();
    const resolved = resolvePersistedPipelineLogTarget({
      currentTarget: undefined,
      restoredTarget,
      canValidateLogTarget: false,
      stages: []
    });
    assert.equal(resolved, restoredTarget);
  });

  it("clears the persisted target when nothing is selected and validation is possible", () => {
    const resolved = resolvePersistedPipelineLogTarget({
      currentTarget: undefined,
      restoredTarget: makeTarget(),
      canValidateLogTarget: true,
      stages: [makeStage()]
    });
    assert.equal(resolved, undefined);
  });
});

describe("planRestoredLogTarget", () => {
  it("does nothing once the restored target has been consumed", () => {
    const plan = planRestoredLogTarget({
      alreadyConsumed: true,
      restoredTarget: makeTarget(),
      canValidateLogTarget: true,
      currentTarget: undefined,
      stages: [makeStage({ logTarget: makeTarget() })]
    });
    assert.deepEqual(plan, { consume: false });
  });

  it("does nothing without a restored target", () => {
    const plan = planRestoredLogTarget({
      alreadyConsumed: false,
      restoredTarget: undefined,
      canValidateLogTarget: true,
      currentTarget: undefined,
      stages: []
    });
    assert.deepEqual(plan, { consume: false });
  });

  it("waits until the target can be validated", () => {
    const plan = planRestoredLogTarget({
      alreadyConsumed: false,
      restoredTarget: makeTarget(),
      canValidateLogTarget: false,
      currentTarget: undefined,
      stages: []
    });
    assert.deepEqual(plan, { consume: false });
  });

  it("consumes without restoring when a log target is already selected", () => {
    const plan = planRestoredLogTarget({
      alreadyConsumed: false,
      restoredTarget: makeTarget(),
      canValidateLogTarget: true,
      currentTarget: makeTarget({ key: "other" }),
      stages: [makeStage({ logTarget: makeTarget() })]
    });
    assert.equal(plan.consume, true);
    assert.equal(plan.targetToRestore, undefined);
  });

  it("consumes without restoring when the restored target no longer exists", () => {
    const plan = planRestoredLogTarget({
      alreadyConsumed: false,
      restoredTarget: makeTarget({ key: "missing" }),
      canValidateLogTarget: true,
      currentTarget: undefined,
      stages: [makeStage({ logTarget: makeTarget() })]
    });
    assert.equal(plan.consume, true);
    assert.equal(plan.targetToRestore, undefined);
  });

  it("restores the persisted target when it is still present", () => {
    const restoredTarget = makeTarget();
    const plan = planRestoredLogTarget({
      alreadyConsumed: false,
      restoredTarget,
      canValidateLogTarget: true,
      currentTarget: undefined,
      stages: [makeStage({ logTarget: makeTarget() })]
    });
    assert.equal(plan.consume, true);
    assert.equal(plan.targetToRestore, restoredTarget);
  });
});

describe("findStageByKey", () => {
  it("finds a top-level stage", () => {
    const stage = makeStage({ key: "top" });
    assert.equal(findStageByKey([makeStage({ key: "other" }), stage], "top"), stage);
  });

  it("finds a stage nested inside parallel branches", () => {
    const branch = makeStage({ key: "branch" });
    const stages = [
      makeStage({
        key: "parent",
        parallelBranches: [makeStage({ key: "sibling" }), branch]
      })
    ];
    assert.equal(findStageByKey(stages, "branch"), branch);
  });

  it("returns undefined when no stage matches", () => {
    assert.equal(findStageByKey([makeStage({ key: "a" })], "missing"), undefined);
  });
});

describe("findStageLogTarget", () => {
  it("returns undefined without a stage key", () => {
    assert.equal(findStageLogTarget([makeStage()], undefined), undefined);
  });

  it("returns the log target of the matching stage", () => {
    const target = makeTarget();
    const stages = [makeStage({ key: "with-log", logTarget: target })];
    assert.equal(findStageLogTarget(stages, "with-log"), target);
  });

  it("returns undefined when the matching stage has no log target", () => {
    assert.equal(findStageLogTarget([makeStage({ key: "no-log" })], "no-log"), undefined);
  });

  it("returns undefined when the stage key is unknown", () => {
    assert.equal(findStageLogTarget([makeStage({ key: "a" })], "missing"), undefined);
  });
});
