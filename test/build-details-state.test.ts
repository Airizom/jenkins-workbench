import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  BuildDetailsUpdateMessage,
  BuildDetailsViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
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

  it("parses initial console html and applies defaults for missing fields", () => {
    const originalDOMParser = globalThis.DOMParser;
    const originalNode = globalThis.Node;
    globalThis.DOMParser = class {
      parseFromString() {
        return { body: { childNodes: [{ nodeType: 3, textContent: "hello" }] } };
      }
    } as unknown as typeof DOMParser;
    globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 } as unknown as typeof Node;
    let state: ReturnType<typeof buildInitialState>;
    try {
      state = buildInitialState({ consoleHtml: "hello" } as BuildDetailsViewModel);
    } finally {
      globalThis.DOMParser = originalDOMParser;
      globalThis.Node = originalNode;
    }

    assert.equal(state.consoleHtml, undefined);
    assert.equal(state.consoleHtmlModel?.text, "hello");
    assert.deepEqual(state.diagnostics, EMPTY_BUILD_DIAGNOSTICS);
    assert.equal(state.loading, false);
    assert.equal(state.hasLoaded, true);
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
        displayName: "app #9",
        keptForever: false,
        canDelete: false,
        canManage: true,
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

describe("pipeline node log html", () => {
  const target = { key: "stage-1", kind: "stage" as const, name: "Build" };

  it("keeps the node log html model across same-target updates without html", () => {
    const logWithoutHtml = { target, text: "two", truncated: false, loading: false };
    const set = {
      ...buildDetailsReducer(buildInitialState({} as BuildDetailsViewModel), {
        type: "setPipelineNodeLog",
        log: logWithoutHtml
      }),
      pipelineNodeLogHtmlModel: { nodes: [], text: "two" }
    };
    assert.equal(
      buildDetailsReducer(set, { type: "setPipelineNodeLog", log: logWithoutHtml })
        .pipelineNodeLogHtmlModel,
      undefined
    );

    const kept = buildDetailsReducer(set, {
      type: "updateDetails",
      payload: { ...set, type: "updateDetails", pipelineNodeLog: logWithoutHtml }
    });
    assert.equal(kept.pipelineNodeLogHtmlModel, set.pipelineNodeLogHtmlModel);

    const cleared = buildDetailsReducer(set, {
      type: "updateDetails",
      payload: {
        ...set,
        type: "updateDetails",
        pipelineNodeLog: { ...logWithoutHtml, target: { ...target, key: "stage-2" } }
      }
    });
    assert.equal(cleared.pipelineNodeLogHtmlModel, undefined);
  });
});

describe("build management state", () => {
  function updatePayload(
    state: ReturnType<typeof buildInitialState>,
    patch: Partial<BuildDetailsUpdateMessage>
  ): BuildDetailsUpdateMessage {
    return {
      type: "updateDetails",
      displayName: state.displayName,
      description: state.description,
      keptForever: state.keptForever,
      canDelete: state.canDelete,
      canManage: state.canManage,
      resultLabel: state.resultLabel,
      resultClass: state.resultClass,
      durationLabel: state.durationLabel,
      timestampLabel: state.timestampLabel,
      culpritsLabel: state.culpritsLabel,
      pipelineStagesLoading: false,
      testState: state.testState,
      coverageState: state.coverageState,
      insights: state.insights,
      pipelineStages: [],
      pipelineNodeLog: state.pipelineNodeLog,
      pendingInputs: [],
      ...patch
    };
  }

  it("defaults management fields for initial state without them", () => {
    const state = buildInitialState({} as BuildDetailsViewModel);

    assert.equal(state.keptForever, false);
    assert.equal(state.canDelete, false);
    assert.equal(state.canManage, false);
    assert.equal(state.description, undefined);
    assert.equal(state.managementBusy, false);
  });

  it("reads management fields from the initial view model", () => {
    const state = buildInitialState({
      displayName: "app Release 1.0",
      description: "Nightly\nfrom main",
      keptForever: true,
      canDelete: true,
      canManage: true
    } as BuildDetailsViewModel);

    assert.equal(state.displayName, "app Release 1.0");
    assert.equal(state.description, "Nightly\nfrom main");
    assert.equal(state.keptForever, true);
    assert.equal(state.canDelete, true);
    assert.equal(state.canManage, true);
  });

  it("applies a rename, keep change, and cleared description from updateDetails", () => {
    const state = buildInitialState({
      displayName: "app #9",
      description: "Old",
      keptForever: false,
      canDelete: false,
      canManage: true
    } as BuildDetailsViewModel);

    const updated = buildDetailsReducer(state, {
      type: "updateDetails",
      payload: updatePayload(state, {
        displayName: "app Release 1.0",
        description: undefined,
        keptForever: true,
        canDelete: true
      })
    });

    assert.equal(updated.displayName, "app Release 1.0");
    assert.equal(updated.description, undefined);
    assert.equal(updated.keptForever, true);
    assert.equal(updated.canDelete, true);
    assert.equal(updated.canManage, true);
  });

  it("stays busy across updates until the extension reports completion", () => {
    const state = buildInitialState({} as BuildDetailsViewModel);

    const started = buildDetailsReducer(state, { type: "startBuildManagementAction" });
    assert.equal(started.managementBusy, true);
    assert.equal(buildDetailsReducer(started, { type: "startBuildManagementAction" }), started);

    const refreshed = buildDetailsReducer(started, {
      type: "updateDetails",
      payload: updatePayload(started, { keptForever: true })
    });
    assert.equal(refreshed.managementBusy, true);

    const completed = buildDetailsReducer(refreshed, { type: "buildManagementActionComplete" });
    assert.equal(completed.managementBusy, false);
    assert.equal(completed.keptForever, true);
    assert.equal(
      buildDetailsReducer(completed, { type: "buildManagementActionComplete" }),
      completed
    );
  });
});
