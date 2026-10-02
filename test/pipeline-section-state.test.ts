import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel,
  PipelineStageViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  canFollowPipelineNodeLog,
  isDefaultStageSelectionDue,
  isSamePersistedPipelineUiState,
  normalizeInitialPipelineState,
  type PersistedPipelineUiState,
  pickDefaultStageToOpen,
  planStageRequest
} from "../src/panels/buildDetails/webview/components/buildDetails/pipelineSectionState";

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

function makeLog(overrides: Partial<PipelineNodeLogViewModel> = {}): PipelineNodeLogViewModel {
  return { text: "", truncated: false, loading: false, ...overrides };
}

describe("normalizeInitialPipelineState", () => {
  it("defaults to the list presentation with no selection", () => {
    assert.deepEqual(normalizeInitialPipelineState({}), {
      presentation: "list",
      selectedStageKey: undefined,
      restoredLogTarget: undefined
    });
  });

  it("keeps valid persisted values and drops blank stage keys", () => {
    const target = makeTarget();
    assert.deepEqual(
      normalizeInitialPipelineState({
        pipelinePresentation: "graph",
        selectedGraphStageKey: "stage-2",
        selectedPipelineLogTarget: target
      }),
      { presentation: "graph", selectedStageKey: "stage-2", restoredLogTarget: target }
    );
    assert.equal(
      normalizeInitialPipelineState({ selectedGraphStageKey: "   " }).selectedStageKey,
      undefined
    );
  });

  it("falls back to the list presentation for unknown values", () => {
    const state = normalizeInitialPipelineState({
      pipelinePresentation: "table" as PersistedPipelineUiState["pipelinePresentation"]
    });
    assert.equal(state.presentation, "list");
  });
});

describe("isSamePersistedPipelineUiState", () => {
  const base: PersistedPipelineUiState = {
    pipelinePresentation: "list",
    selectedGraphStageKey: "stage-1",
    selectedPipelineLogTarget: makeTarget({ childNodeIds: ["11", "12"] })
  };

  it("never matches when nothing was persisted yet", () => {
    assert.equal(isSamePersistedPipelineUiState(undefined, base), false);
  });

  it("matches structurally equal payloads with new identities", () => {
    assert.equal(
      isSamePersistedPipelineUiState(base, {
        ...base,
        selectedPipelineLogTarget: makeTarget({ childNodeIds: ["11", "12"] })
      }),
      true
    );
  });

  it("detects presentation and stage key changes", () => {
    assert.equal(
      isSamePersistedPipelineUiState(base, { ...base, pipelinePresentation: "graph" }),
      false
    );
    assert.equal(
      isSamePersistedPipelineUiState(base, { ...base, selectedGraphStageKey: "x" }),
      false
    );
  });

  it("detects log target field and child node changes", () => {
    const withTarget = (target?: PipelineLogTargetViewModel) => ({
      ...base,
      selectedPipelineLogTarget: target
    });
    assert.equal(isSamePersistedPipelineUiState(base, withTarget(undefined)), false);
    assert.equal(
      isSamePersistedPipelineUiState(withTarget(undefined), withTarget(undefined)),
      true
    );
    assert.equal(
      isSamePersistedPipelineUiState(
        base,
        withTarget(makeTarget({ nodeId: "99", childNodeIds: ["11", "12"] }))
      ),
      false
    );
    assert.equal(
      isSamePersistedPipelineUiState(base, withTarget(makeTarget({ childNodeIds: ["11"] }))),
      false
    );
    assert.equal(
      isSamePersistedPipelineUiState(base, withTarget(makeTarget({ childNodeIds: ["11", "13"] }))),
      false
    );
    assert.equal(isSamePersistedPipelineUiState(base, withTarget(makeTarget())), false);
    assert.equal(
      isSamePersistedPipelineUiState(withTarget(makeTarget()), withTarget(makeTarget())),
      true
    );
  });
});

describe("isDefaultStageSelectionDue", () => {
  const ready = {
    done: false,
    isActive: true,
    canValidateLogTarget: true,
    stageCount: 2,
    hasRestoredTarget: false,
    restoreConsumed: false
  };

  it("is due once the tab is active with validated stages", () => {
    assert.equal(isDefaultStageSelectionDue(ready), true);
  });

  it("waits for every gate", () => {
    assert.equal(isDefaultStageSelectionDue({ ...ready, done: true }), false);
    assert.equal(isDefaultStageSelectionDue({ ...ready, isActive: false }), false);
    assert.equal(isDefaultStageSelectionDue({ ...ready, canValidateLogTarget: false }), false);
    assert.equal(isDefaultStageSelectionDue({ ...ready, stageCount: 0 }), false);
    assert.equal(isDefaultStageSelectionDue({ ...ready, hasRestoredTarget: true }), false);
    assert.equal(
      isDefaultStageSelectionDue({ ...ready, hasRestoredTarget: true, restoreConsumed: true }),
      true
    );
  });
});

describe("pickDefaultStageToOpen", () => {
  const stages = [
    makeStage({ key: "a", statusClass: "success" }),
    makeStage({ key: "b", statusClass: "failure" })
  ];

  it("opens the explaining stage when nothing is selected", () => {
    const stage = pickDefaultStageToOpen({
      stages,
      isRunning: false,
      hasCurrentTarget: false,
      restoredLogSelected: false
    });
    assert.equal(stage?.key, "b");
  });

  it("leaves existing or restored selections alone", () => {
    const options = {
      stages,
      isRunning: false,
      hasCurrentTarget: false,
      restoredLogSelected: false
    };
    assert.equal(pickDefaultStageToOpen({ ...options, hasCurrentTarget: true }), undefined);
    assert.equal(pickDefaultStageToOpen({ ...options, restoredLogSelected: true }), undefined);
  });
});

describe("planStageRequest", () => {
  const stages = [
    makeStage({ key: "a" }),
    makeStage({ key: "b", parallelBranches: [makeStage({ key: "b1" })] })
  ];

  it("ignores a missing or already handled request", () => {
    assert.deepEqual(planStageRequest({ request: undefined, lastHandledId: undefined, stages }), {
      consume: false
    });
    assert.deepEqual(
      planStageRequest({ request: { stageKey: "a", id: 2 }, lastHandledId: 2, stages }),
      { consume: false }
    );
  });

  it("opens the requested stage once per request id, including repeat clicks", () => {
    const first = planStageRequest({
      request: { stageKey: "b", id: 1 },
      lastHandledId: undefined,
      stages
    });
    assert.equal(first.consume, true);
    assert.equal(first.stage?.key, "b");

    const repeat = planStageRequest({
      request: { stageKey: "b", id: 2 },
      lastHandledId: 1,
      stages
    });
    assert.equal(repeat.stage?.key, "b");
  });

  it("consumes a request whose stage no longer exists without opening anything", () => {
    assert.deepEqual(
      planStageRequest({ request: { stageKey: "gone", id: 3 }, lastHandledId: 2, stages }),
      { consume: true, stage: undefined }
    );
  });
});

describe("canFollowPipelineNodeLog", () => {
  const target = makeTarget({ key: "run" });
  const stages = [makeStage({ key: "run", statusClass: "running", logTarget: target })];

  it("never follows a finished build", () => {
    assert.equal(
      canFollowPipelineNodeLog(stages, makeLog({ target, polling: true }), false),
      false
    );
  });

  it("follows while polling or while the selected node is running", () => {
    assert.equal(canFollowPipelineNodeLog([], makeLog({ polling: true }), true), true);
    assert.equal(canFollowPipelineNodeLog(stages, makeLog({ target }), true), true);
    assert.equal(canFollowPipelineNodeLog([], makeLog({ target }), true), false);
  });
});
