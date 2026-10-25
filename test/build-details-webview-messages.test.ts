import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildArtifactActionMessage } from "../src/panels/buildDetails/webview/buildDetailsWebviewMessages";
import type { BuildFailureArtifact } from "../src/panels/buildDetails/shared/BuildDetailsContracts";

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
});
