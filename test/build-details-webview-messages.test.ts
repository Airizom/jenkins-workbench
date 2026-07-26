import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildArtifactActionMessage,
  buildOpenTestSourceMessage,
  buildReloadTestReportMessage
} from "../src/panels/buildDetails/webview/buildDetailsWebviewMessages";
import type {
  BuildFailureArtifact,
  BuildTestCaseViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";

describe("BuildDetails webview messages", () => {
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
