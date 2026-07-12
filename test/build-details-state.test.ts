import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { BuildDetailsViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { buildInitialState } from "../src/panels/buildDetails/webview/state/buildDetailsState";

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
  });
});
