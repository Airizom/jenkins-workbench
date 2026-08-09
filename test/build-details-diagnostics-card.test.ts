import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { EMPTY_BUILD_DIAGNOSTICS } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { describeBuildDiagnostics } from "../src/panels/buildDetails/webview/components/buildDetails/buildFailure/BuildFailureDiagnosticsCard";

describe("Build Details diagnostics card", () => {
  it("describes scan states and source-resolution limits", () => {
    const summary = describeBuildDiagnostics({
      ...EMPTY_BUILD_DIAGNOSTICS,
      status: "truncated",
      errorCount: 2,
      warningCount: 1,
      resolvedCount: 3,
      unresolvedCount: 2,
      omittedCount: 4,
      warnings: ["The local checkout differs from the Jenkins revision."]
    });

    assert.equal(summary.countLabel, "2 errors · 1 warning");
    assert.equal(summary.emptyMessage, "No local source diagnostics were found.");
    assert.deepEqual(summary.notices, [
      "The console byte limit was reached; results may be incomplete.",
      "The local checkout differs from the Jenkins revision.",
      "4 problems omitted by the configured limit.",
      "2 source paths could not be uniquely resolved."
    ]);
  });

  it("uses backend status messages when present", () => {
    const summary = describeBuildDiagnostics({
      ...EMPTY_BUILD_DIAGNOSTICS,
      status: "needsRepository",
      message: "Choose the checkout for team/service."
    });

    assert.equal(summary.emptyMessage, "Choose the checkout for team/service.");
  });
});
