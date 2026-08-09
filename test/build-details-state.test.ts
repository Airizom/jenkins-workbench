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
});
