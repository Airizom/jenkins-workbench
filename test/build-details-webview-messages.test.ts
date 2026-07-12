import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildApproveInputMessage,
  buildArtifactActionMessage,
  buildClearPipelineLogNodeMessage,
  buildExportConsoleMessage,
  buildExportPipelineNodeLogMessage,
  buildOpenTestSourceMessage,
  buildRefreshBuildDetailsMessage,
  buildRejectInputMessage,
  buildReloadTestReportMessage,
  buildRestartPipelineFromStageMessage,
  buildSelectPipelineLogNodeMessage,
  buildToggleFollowLogMessage
} from "../src/panels/buildDetails/webview/buildDetailsWebviewMessages";
import type {
  BuildFailureArtifact,
  BuildTestCaseViewModel,
  PipelineLogTargetViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";

describe("BuildDetails webview messages", () => {
  it("builds console and pipeline control messages", () => {
    const target: PipelineLogTargetViewModel = {
      key: "stage:Build",
      kind: "stage",
      name: "Build",
      nodeId: "7"
    };

    assert.deepEqual(buildToggleFollowLogMessage(true), {
      type: "toggleFollowLog",
      value: true
    });
    assert.deepEqual(buildExportConsoleMessage(), { type: "exportConsole" });
    assert.deepEqual(buildRestartPipelineFromStageMessage("Build"), {
      type: "restartPipelineFromStage",
      stageName: "Build"
    });
    assert.deepEqual(buildSelectPipelineLogNodeMessage(target), {
      type: "selectPipelineLogNode",
      target
    });
    assert.deepEqual(buildClearPipelineLogNodeMessage(), { type: "clearPipelineLogNode" });
    assert.deepEqual(buildExportPipelineNodeLogMessage(), { type: "exportPipelineNodeLog" });
    assert.deepEqual(buildRefreshBuildDetailsMessage(), { type: "refreshBuildDetails" });
  });

  it("builds pending input decision messages", () => {
    assert.deepEqual(buildApproveInputMessage("deploy-prod"), {
      type: "approveInput",
      inputId: "deploy-prod"
    });
    assert.deepEqual(buildRejectInputMessage("deploy-prod"), {
      type: "rejectInput",
      inputId: "deploy-prod"
    });
  });

  it("builds artifact action messages with backend payload fields", () => {
    const artifact: BuildFailureArtifact = {
      name: "Report",
      fileName: "report.html",
      relativePath: "reports/report.html"
    };

    assert.deepEqual(buildArtifactActionMessage("preview", artifact), {
      type: "artifactAction",
      action: "preview",
      relativePath: "reports/report.html",
      fileName: "report.html"
    });
    assert.deepEqual(buildArtifactActionMessage("download", { ...artifact, fileName: undefined }), {
      type: "artifactAction",
      action: "download",
      relativePath: "reports/report.html",
      fileName: undefined
    });
  });

  it("builds test result messages", () => {
    const testCase: BuildTestCaseViewModel = {
      id: "suite/example test",
      name: "example test",
      className: "com.example.BuildTest",
      suiteName: "BuildTest",
      status: "failed",
      statusLabel: "Failed",
      canOpenSource: true
    };

    assert.deepEqual(buildReloadTestReportMessage(), {
      type: "reloadTestReport",
      includeCaseLogs: true
    });
    assert.deepEqual(buildOpenTestSourceMessage(testCase), {
      type: "openTestSource",
      testName: "example test",
      className: "com.example.BuildTest",
      suiteName: "BuildTest"
    });
  });
});
