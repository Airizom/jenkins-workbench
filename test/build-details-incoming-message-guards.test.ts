import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isArtifactActionMessage,
  isPersistUiStateMessage,
  isSelectPipelineLogNodeMessage
} from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import {
  isBuildDetailsPanelState,
  normalizeBuildDetailsPanelUiState
} from "../src/panels/buildDetails/shared/BuildDetailsPanelWebviewState";

const validTarget = { key: "stage-1", kind: "stage", name: "Build", nodeId: "12" };

describe("build details incoming message guards", () => {
  it("validates optional artifact file names", () => {
    const base = { type: "artifactAction", action: "download", relativePath: "a" };
    assert.equal(isArtifactActionMessage(base), true);
    assert.equal(isArtifactActionMessage({ ...base, fileName: "a.txt" }), true);
    assert.equal(isArtifactActionMessage({ ...base, fileName: 7 }), false);
  });

  it("rejects pipeline log targets with malformed fields", () => {
    const base = { type: "selectPipelineLogNode" };
    assert.equal(isSelectPipelineLogNodeMessage({ ...base, target: validTarget }), true);
    assert.equal(
      isSelectPipelineLogNodeMessage({ ...base, target: { ...validTarget, childNodeIds: [1] } }),
      false
    );
    assert.equal(
      isSelectPipelineLogNodeMessage({ ...base, target: { ...validTarget, childNodeIds: "13" } }),
      false
    );
  });

  it("rejects UI state with any invalid field", () => {
    const base = { type: "persistUiState" };
    assert.equal(
      isPersistUiStateMessage({
        ...base,
        uiState: { selectedTab: "pipeline", pipelinePresentation: "graph" }
      }),
      true
    );
    assert.equal(
      isPersistUiStateMessage({
        ...base,
        uiState: { selectedTab: "invalid", pipelinePresentation: "graph" }
      }),
      false
    );
    assert.equal(
      isPersistUiStateMessage({
        ...base,
        uiState: { pipelinePresentation: "graph", selectedPipelineLogTarget: { key: 1 } }
      }),
      false
    );
  });

  it("restores serialized panel state and drops stale UI state fields when read", () => {
    const state = {
      environmentId: "env",
      scope: "workspace",
      buildUrl: "https://jenkins.example/job/a/1/"
    };
    const staleUi = { selectedTab: "removed-tab", pipelinePresentation: "graph" };
    assert.equal(isBuildDetailsPanelState({ ...state, buildDetailsUi: {} }), true);
    assert.equal(isBuildDetailsPanelState({ ...state, buildDetailsUi: staleUi }), true);
    assert.equal(isBuildDetailsPanelState({ ...state, buildDetailsUi: "graph" }), false);
    assert.deepEqual(normalizeBuildDetailsPanelUiState(staleUi), {
      selectedTab: undefined,
      pipelinePresentation: "graph",
      selectedGraphStageKey: undefined,
      selectedPipelineLogTarget: undefined
    });
  });
});
