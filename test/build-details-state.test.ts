import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { BuildDetailsViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { EMPTY_BUILD_DIAGNOSTICS } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  buildDetailsReducer,
  buildInitialState
} from "../src/panels/buildDetails/webview/state/buildDetailsState";

describe("buildInitialState", () => {
  it("falls back when legacy initial state has no pipeline node log", () => {
    const state = buildInitialState({
      pipelineNodeLog: undefined
    } as unknown as BuildDetailsViewModel);

    assert.deepEqual(state.pipelineNodeLog, {
      text: "",
      truncated: false,
      loading: false
    });
    assert.equal(state.pipelineNodeLogHtmlModel, undefined);
    assert.deepEqual(state.diagnostics, EMPTY_BUILD_DIAGNOSTICS);
  });

  it("replaces build diagnostics independently from build detail updates", () => {
    const state = buildInitialState({} as BuildDetailsViewModel);
    const diagnostics = {
      ...EMPTY_BUILD_DIAGNOSTICS,
      status: "available" as const,
      errorCount: 1,
      resolvedCount: 1,
      items: [{ severity: "error" as const, message: "Compile failed", targetId: "target-1" }]
    };

    const updated = buildDetailsReducer(state, { type: "setBuildDiagnostics", diagnostics });

    assert.equal(updated.diagnostics, diagnostics);
    assert.equal(updated.resultLabel, state.resultLabel);
  });

  it("tracks pending-input actions until the extension reports completion", () => {
    const state = buildInitialState({} as BuildDetailsViewModel);
    assert.deepEqual(state.processingInputActions, {});

    const started = buildDetailsReducer(state, {
      type: "startPendingInputAction",
      inputId: "deploy",
      action: "reject"
    });
    assert.deepEqual(started.processingInputActions, { deploy: "reject" });

    const repeated = buildDetailsReducer(started, {
      type: "startPendingInputAction",
      inputId: "deploy",
      action: "approve"
    });
    assert.equal(repeated, started);

    const completed = buildDetailsReducer(started, {
      type: "pendingInputActionComplete",
      inputId: "deploy"
    });
    assert.deepEqual(completed.processingInputActions, {});
  });

  it("drops busy state for inputs that are no longer pending", () => {
    const state = buildDetailsReducer(buildInitialState({} as BuildDetailsViewModel), {
      type: "startPendingInputAction",
      inputId: "deploy",
      action: "approve"
    });

    const updated = buildDetailsReducer(state, {
      type: "updateDetails",
      payload: {
        type: "updateDetails",
        resultLabel: "Running",
        resultClass: "running",
        durationLabel: "1m",
        timestampLabel: "today",
        culpritsLabel: "None",
        pipelineStagesLoading: false,
        testState: state.testState,
        coverageState: state.coverageState,
        insights: state.insights,
        pipelineStages: [],
        pipelineNodeLog: state.pipelineNodeLog,
        pendingInputs: []
      }
    });

    assert.deepEqual(updated.processingInputActions, {});
  });
});
