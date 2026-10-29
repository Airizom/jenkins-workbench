import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  BuildDetailsMessageRouter,
  type BuildDetailsMessageRouterHandlers
} from "../src/panels/buildDetails/BuildDetailsMessageRouter";
import {
  isApproveInputMessage,
  isArtifactActionMessage,
  isCopyBuildLinkMessage,
  isDownloadAllArtifactsMessage,
  isOpenPendingInputInJenkinsMessage,
  isPersistUiStateMessage,
  isSelectPipelineLogNodeMessage
} from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";
import type { PipelineLogTargetViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  isBuildDetailsPanelState,
  normalizeBuildDetailsPanelUiState,
  withBuildDetailsPanelUiState
} from "../src/panels/buildDetails/shared/BuildDetailsPanelWebviewState";

const validTarget = { key: "stage-1", kind: "stage", name: "Build", nodeId: "12" };

describe("build details incoming message guards", () => {
  it("accepts only the archive download message type", () => {
    assert.equal(isDownloadAllArtifactsMessage({ type: "downloadAllArtifacts" }), true);
    for (const message of [
      undefined,
      null,
      "downloadAllArtifacts",
      {},
      { type: "artifactAction" }
    ]) {
      assert.equal(isDownloadAllArtifactsMessage(message), false);
    }
    assert.equal(isArtifactActionMessage({ type: "artifactAction", action: "downloadAll" }), false);
  });

  it("accepts only the copy build link message type", () => {
    assert.equal(isCopyBuildLinkMessage({ type: "copyBuildLink" }), true);
    for (const message of [undefined, null, "copyBuildLink", {}, { type: "openExternal" }]) {
      assert.equal(isCopyBuildLinkMessage(message), false);
    }
  });

  it("accepts open-in-Jenkins requests only with an input id", () => {
    assert.equal(
      isOpenPendingInputInJenkinsMessage({ type: "openPendingInputInJenkins", inputId: "deploy" }),
      true
    );
    for (const message of [
      undefined,
      null,
      { type: "openPendingInputInJenkins" },
      { type: "openPendingInputInJenkins", inputId: "" },
      { type: "openPendingInputInJenkins", inputId: 7 },
      { type: "approveInput", inputId: "deploy" }
    ]) {
      assert.equal(isOpenPendingInputInJenkinsMessage(message), false);
    }
    assert.equal(
      isApproveInputMessage({ type: "openPendingInputInJenkins", inputId: "deploy" }),
      false
    );
  });

  it("routes open-in-Jenkins requests by input id without a webview URL", () => {
    const onOpenPendingInputInJenkins = vi.fn();
    const onApproveInput = vi.fn();
    const onOpenExternal = vi.fn();
    const router = new BuildDetailsMessageRouter({
      onOpenPendingInputInJenkins,
      onApproveInput,
      onOpenExternal
    } as unknown as BuildDetailsMessageRouterHandlers);

    router.route({ type: "openPendingInputInJenkins", inputId: "deploy" });
    router.route({ type: "openPendingInputInJenkins" });

    assert.deepEqual(onOpenPendingInputInJenkins.mock.calls, [
      [{ type: "openPendingInputInJenkins", inputId: "deploy" }]
    ]);
    assert.equal(onApproveInput.mock.calls.length, 0);
    assert.equal(onOpenExternal.mock.calls.length, 0);
  });

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

  it("accepts persistUiState messages that only clear fields so the clear is persisted", () => {
    const message = {
      type: "persistUiState",
      uiState: { selectedGraphStageKey: undefined, selectedPipelineLogTarget: undefined }
    };
    assert.equal(isPersistUiStateMessage(message), true);
    assert.equal(isPersistUiStateMessage({ type: "persistUiState", uiState: {} }), true);
    assert.equal(isPersistUiStateMessage({ type: "persistUiState" }), false);

    const state = withBuildDetailsPanelUiState(
      {
        environmentId: "env",
        scope: "workspace",
        buildUrl: "https://jenkins.example/job/a/1/"
      },
      { selectedPipelineLogTarget: validTarget as PipelineLogTargetViewModel }
    );
    assert.equal(
      normalizeBuildDetailsPanelUiState(state.buildDetailsUi)?.selectedPipelineLogTarget?.key,
      "stage-1"
    );
    const cleared = withBuildDetailsPanelUiState(state, message.uiState);
    assert.equal(cleared.buildDetailsUi, undefined);
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
