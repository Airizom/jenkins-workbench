import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  type BuildDiagnosticsViewModel,
  EMPTY_BUILD_DIAGNOSTICS
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  BuildFailureDiagnosticsCard,
  describeBuildDiagnostics
} from "../src/panels/buildDetails/webview/components/buildDetails/buildFailure/BuildFailureDiagnosticsCard";

function renderCard(diagnostics: BuildDiagnosticsViewModel): string {
  return renderToStaticMarkup(
    createElement(BuildFailureDiagnosticsCard, {
      diagnostics,
      onOpenSource: () => undefined,
      onShowProblems: () => undefined,
      onConfigure: () => undefined
    })
  );
}

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

  it("names diagnostic rows by severity and message rather than position", () => {
    const html = renderCard({
      ...EMPTY_BUILD_DIAGNOSTICS,
      status: "available",
      errorCount: 1,
      resolvedCount: 1,
      items: [{ severity: "error", message: "Cannot find symbol Foo", targetId: "t-1" }]
    });

    assert.doesNotMatch(html, /Open diagnostic 1/);
    assert.match(html, /<span class="sr-only">Error: <\/span>Cannot find symbol Foo/);
    assert.match(html, /title="Cannot find symbol Foo"/);
    assert.match(html, /aria-describedby="build-diagnostics-opens-in-editor"/);
    assert.match(html, /Opens in editor/);
    assert.match(html, /Configure diagnostics…/);
  });

  it("explains why Show Problems is disabled while the scan is pending", () => {
    const html = renderCard({ ...EMPTY_BUILD_DIAGNOSTICS, status: "scanning" });

    assert.match(html, /disabled=""[^>]*title="Available after the diagnostic scan finishes\."/);
    assert.match(html, /aria-describedby="build-diagnostics-show-problems-hint"/);
  });
});
