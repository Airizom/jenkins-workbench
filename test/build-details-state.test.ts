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

  it.each(["deploy", "constructor", "toString", "__proto__"])(
    "tracks pending-input actions for %s until the extension reports completion",
    (inputId) => {
      const state = buildInitialState({} as BuildDetailsViewModel);
      assert.deepEqual(Object.keys(state.processingInputActions), []);
      assert.equal(state.processingInputActions[inputId], undefined);

      const started = buildDetailsReducer(state, {
        type: "startPendingInputAction",
        inputId,
        action: "reject"
      });
      assert.equal(Object.hasOwn(started.processingInputActions, inputId), true);
      assert.equal(started.processingInputActions[inputId], "reject");
      assert.equal(state.processingInputActions[inputId], undefined);

      const repeated = buildDetailsReducer(started, {
        type: "startPendingInputAction",
        inputId,
        action: "approve"
      });
      assert.equal(repeated, started);

      const completed = buildDetailsReducer(started, {
        type: "pendingInputActionComplete",
        inputId
      });
      assert.deepEqual(Object.keys(completed.processingInputActions), []);
      assert.equal(completed.processingInputActions[inputId], undefined);
      assert.equal(Object.hasOwn(completed.processingInputActions, inputId), false);
      assert.equal(started.processingInputActions[inputId], "reject");

      const restarted = buildDetailsReducer(completed, {
        type: "startPendingInputAction",
        inputId,
        action: "approve"
      });
      assert.equal(restarted.processingInputActions[inputId], "approve");
    }
  );

  it.each(["constructor", "toString", "__proto__"])(
    "preserves processing state for %s when pruning another input",
    (inputId) => {
      let state = buildInitialState({} as BuildDetailsViewModel);
      for (const id of [inputId, "deploy"]) {
        state = buildDetailsReducer(state, {
          type: "startPendingInputAction",
          inputId: id,
          action: "approve"
        });
      }

      const updated = buildDetailsReducer(state, {
        type: "updateDetails",
        payload: {
          ...state,
          type: "updateDetails",
          pendingInputs: [
            {
              id: inputId,
              message: "Continue?",
              submitterLabel: "",
              parametersLabel: "",
              parameters: []
            }
          ]
        }
      });

      assert.deepEqual(Object.entries(updated.processingInputActions), [[inputId, "approve"]]);
      assert.equal(updated.processingInputActions.deploy, undefined);
      assert.equal(Object.getPrototypeOf(updated.processingInputActions), null);
      assert.equal(state.processingInputActions.deploy, "approve");
    }
  );

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

    assert.deepEqual(Object.keys(updated.processingInputActions), []);
    assert.equal(Object.getPrototypeOf(updated.processingInputActions), null);
  });
});
