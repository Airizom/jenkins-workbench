import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { BUILD_DIAGNOSTIC_SCAN_STATUSES } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  isConfigureBuildDiagnosticsMessage,
  isOpenDiagnosticSourceMessage,
  isShowBuildDiagnosticProblemsMessage,
  parseBuildDetailsOutgoingMessage
} from "../src/panels/buildDetails/shared/BuildDetailsPanelMessages";

const validDiagnostics = {
  status: "available",
  errorCount: 1,
  warningCount: 0,
  informationCount: 0,
  resolvedCount: 1,
  unresolvedCount: 0,
  omittedCount: 0,
  items: [
    {
      severity: "error",
      message: "Type mismatch",
      locationLabel: "src/main.ts:12:4",
      targetId: "scan-1:target-1"
    }
  ],
  warnings: [],
  consoleReferences: [{ targetId: "scan-1:target-1", startOffset: 20, endOffset: 36 }]
};

describe("Build Details diagnostic messages", () => {
  it("accepts a complete diagnostic snapshot", () => {
    assert.deepEqual(
      parseBuildDetailsOutgoingMessage({
        type: "setBuildDiagnostics",
        diagnostics: validDiagnostics
      }),
      {
        type: "setBuildDiagnostics",
        diagnostics: {
          ...validDiagnostics,
          items: [{ ...validDiagnostics.items[0], source: undefined, code: undefined }],
          message: undefined
        }
      }
    );
  });

  it("accepts every declared diagnostic scan status", () => {
    for (const status of BUILD_DIAGNOSTIC_SCAN_STATUSES) {
      assert.notEqual(
        parseBuildDetailsOutgoingMessage({
          type: "setBuildDiagnostics",
          diagnostics: { ...validDiagnostics, status }
        }),
        undefined
      );
    }
  });

  it("rejects malformed snapshots and unsafe console ranges", () => {
    assert.equal(
      parseBuildDetailsOutgoingMessage({
        type: "setBuildDiagnostics",
        diagnostics: {
          ...validDiagnostics,
          items: Array.from({ length: 6 }, () => validDiagnostics.items[0])
        }
      }),
      undefined
    );
    assert.equal(
      parseBuildDetailsOutgoingMessage({
        type: "setBuildDiagnostics",
        diagnostics: {
          ...validDiagnostics,
          consoleReferences: [{ targetId: "target", startOffset: 10, endOffset: 10 }]
        }
      }),
      undefined
    );
  });

  it("validates diagnostic action messages", () => {
    assert.equal(
      isOpenDiagnosticSourceMessage({ type: "openDiagnosticSource", targetId: "target-1" }),
      true
    );
    assert.equal(
      isOpenDiagnosticSourceMessage({ type: "openDiagnosticSource", targetId: " " }),
      false
    );
    assert.equal(isConfigureBuildDiagnosticsMessage({ type: "configureBuildDiagnostics" }), true);
    assert.equal(
      isShowBuildDiagnosticProblemsMessage({ type: "showBuildDiagnosticProblems" }),
      true
    );
  });
});
