import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  type BuildFailureInsightsViewModel,
  EMPTY_BUILD_DIAGNOSTICS
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { BuildFailureInsightsSection } from "../src/panels/buildDetails/webview/components/buildDetails/BuildFailureInsightsSection";

const INSIGHTS: BuildFailureInsightsViewModel = {
  changelogItems: [],
  changelogOverflow: 0,
  testSummaryLabel: "2 failed, 918 passed",
  hasFailedTests: true,
  artifacts: [],
  artifactsOverflow: 0
};

function render(insights: BuildFailureInsightsViewModel, showTestsSummary: boolean): string {
  return renderToStaticMarkup(
    createElement(BuildFailureInsightsSection, {
      insights,
      diagnostics: EMPTY_BUILD_DIAGNOSTICS,
      showTestsSummary,
      onArtifactAction: () => undefined,
      onOpenDiagnosticSource: () => undefined,
      onShowDiagnosticProblems: () => undefined,
      onConfigureBuildDiagnostics: () => undefined
    })
  );
}

describe("BuildFailureInsightsSection", () => {
  it("shows the tests card when no other test summary is on screen", () => {
    assert.match(render(INSIGHTS, true), /2 failed, 918 passed/);
  });

  it("omits the duplicate tests card when the overview already summarizes tests", () => {
    assert.doesNotMatch(render(INSIGHTS, false), /2 failed, 918 passed/);
  });

  it("keeps the tests card when it carries a hint", () => {
    const html = render({ ...INSIGHTS, testResultsHint: "Test report is still loading." }, false);
    assert.match(html, /Test report is still loading\./);
  });
});
