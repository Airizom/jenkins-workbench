import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  type BuildDetailsCoverageStateViewModel,
  type BuildFailureInsightsViewModel,
  type BuildTestsSummaryViewModel,
  EMPTY_BUILD_DIAGNOSTICS,
  type PipelineStageViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { BuildFailureArtifactsCard } from "../src/panels/buildDetails/webview/components/buildDetails/buildFailure/BuildFailureArtifactsCard";
import {
  BuildFailureChangelogCard,
  isLongChangelogMessage
} from "../src/panels/buildDetails/webview/components/buildDetails/buildFailure/BuildFailureChangelogCard";
import { OverviewTab } from "../src/panels/buildDetails/webview/components/buildDetails/overview/OverviewTab";
import { StageNode } from "../src/panels/buildDetails/webview/components/buildDetails/pipelineStages/StageNode";
import { TestResultsSection } from "../src/panels/buildDetails/webview/components/buildDetails/TestResultsSection";
import { shouldShowScrollToTop } from "../src/panels/buildDetails/webview/hooks/useScrollToTopButton";
import { Accordion } from "../src/panels/shared/webview/components/ui/accordion";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

const NO_TESTS: BuildTestsSummaryViewModel = {
  totalCount: 0,
  failedCount: 0,
  skippedCount: 0,
  passedCount: 0,
  summaryLabel: "No test results",
  hasAnyResults: false,
  hasDetailedResults: false,
  detailsUnavailable: false,
  logsIncluded: false,
  canLoadLogs: false
};

const NO_COVERAGE: BuildDetailsCoverageStateViewModel = {
  status: "disabled",
  showTab: false,
  qualityGates: [],
  modifiedFiles: [],
  summaryOnly: false
};

const NO_INSIGHTS: BuildFailureInsightsViewModel = {
  changelogItems: [],
  changelogOverflow: 0,
  testSummaryLabel: "",
  hasFailedTests: false,
  artifacts: [],
  artifactsOverflow: 0
};

function renderOverview(overrides: Partial<Parameters<typeof OverviewTab>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(OverviewTab, {
      resultLabel: "Success",
      resultClass: "success",
      durationLabel: "4m 52s",
      timestampLabel: "today",
      hasPipelineStages: true,
      testsSummary: NO_TESTS,
      coverageState: NO_COVERAGE,
      insights: NO_INSIGHTS,
      diagnostics: EMPTY_BUILD_DIAGNOSTICS,
      hasTests: false,
      onNavigateTab: () => undefined,
      onArtifactAction: () => undefined,
      onOpenDiagnosticSource: () => undefined,
      onShowDiagnosticProblems: () => undefined,
      onConfigureBuildDiagnostics: () => undefined,
      ...overrides
    })
  );
}

describe("OverviewTab", () => {
  it("falls back to a build summary instead of rendering blank", () => {
    const html = renderOverview();
    assert.match(html, />Build summary</);
    assert.match(html, />Success</);
    assert.match(html, /4m 52s/);
    assert.match(html, />View console</);
    assert.match(html, />View pipeline</);
  });

  it("omits the pipeline link for builds without stages", () => {
    const html = renderOverview({ hasPipelineStages: false });
    assert.match(html, />View console</);
    assert.doesNotMatch(html, /View pipeline/);
  });

  it("skips the fallback when anything else is on the tab", () => {
    const html = renderOverview({
      insights: {
        ...NO_INSIGHTS,
        changelogItems: [{ message: "Fix login", author: "Jane", commitId: "abc" }]
      }
    });
    assert.match(html, /Fix login/);
    assert.doesNotMatch(html, /View console/);
  });
});

describe("BuildFailureArtifactsCard", () => {
  it("shows the artifact path as visible text rather than a hover-only tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(BuildFailureArtifactsCard, {
          items: [{ name: "junit.xml", fileName: "junit.xml", relativePath: "reports/junit.xml" }],
          overflowCount: 0,
          onArtifactAction: () => undefined
        })
      )
    );
    assert.match(html, />junit\.xml</);
    assert.match(html, />reports\/junit\.xml</);
  });
});

describe("BuildFailureChangelogCard", () => {
  it("only offers to expand long or multi-line messages", () => {
    assert.equal(isLongChangelogMessage("Fix login"), false);
    assert.equal(isLongChangelogMessage("Subject\n\nBody"), true);
    assert.equal(isLongChangelogMessage("x".repeat(121)), true);
  });

  it("renders the full commit id as selectable text", () => {
    const html = renderToStaticMarkup(
      createElement(BuildFailureChangelogCard, {
        items: [
          { message: `Subject\n\n${"Body ".repeat(40)}`, author: "Jane", commitId: "4f2c9a1b7e3d" }
        ],
        overflowCount: 0
      })
    );
    assert.match(html, /<code[^>]*select-all[^>]*>4f2c9a1b7e3d<\/code>/);
    assert.match(html, /aria-expanded="false"[^>]*>Show more</);
  });
});

describe("TestResultsSection", () => {
  it("offers to clear filters when no test matches them", () => {
    const html = renderToStaticMarkup(
      createElement(TestResultsSection, {
        summary: {
          ...NO_TESTS,
          totalCount: 2,
          failedCount: 1,
          passedCount: 1,
          summaryLabel: "1 failed, 1 passed",
          hasAnyResults: true,
          hasDetailedResults: true
        },
        results: {
          loading: false,
          items: [
            {
              id: "t1",
              name: "passes",
              status: "passed",
              statusLabel: "Passed",
              canOpenSource: false
            }
          ]
        },
        coverageState: NO_COVERAGE,
        onReloadWithLogs: () => undefined,
        onOpenSource: () => undefined
      })
    );
    assert.match(html, /No matching tests/);
    assert.match(html, />Clear filters</);
  });
});

describe("shouldShowScrollToTop", () => {
  it("appears after a scroll distance rather than only at the bottom", () => {
    assert.equal(shouldShowScrollToTop({ scrollTop: 100, clientHeight: 600 }), false);
    assert.equal(shouldShowScrollToTop({ scrollTop: 401, clientHeight: 600 }), true);
    assert.equal(shouldShowScrollToTop({ scrollTop: 450, clientHeight: 1200 }), false);
    assert.equal(shouldShowScrollToTop({ scrollTop: 601, clientHeight: 1200 }), true);
  });
});

describe("StageNode steps filter", () => {
  const step = (key: string, statusClass: string) => ({
    key,
    name: `step ${key}`,
    statusLabel: statusClass,
    statusClass,
    durationLabel: "1s",
    canOpenLog: false
  });
  const branch: PipelineStageViewModel = {
    key: "branch",
    name: "Lint",
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1s",
    canRestartFromStage: false,
    hasSteps: true,
    stepsFailedOnly: [],
    stepsAll: [step("b1", "success")],
    parallelBranches: [],
    canOpenLog: false
  };
  const stage: PipelineStageViewModel = {
    ...branch,
    key: "stage",
    name: "Tests",
    statusClass: "failure",
    statusLabel: "Failed",
    stepsFailedOnly: [step("s1", "failure")],
    stepsAll: [step("s1", "failure"), step("s2", "success")],
    parallelBranches: [branch]
  };

  it("uses one clearly labelled toggle for direct and branch steps", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(
          Accordion,
          { type: "multiple", value: ["stage"] },
          createElement(StageNode, {
            stageId: "stage",
            stage,
            showAll: false,
            isLast: true,
            onRestartStage: () => undefined,
            onSelectPipelineLog: () => undefined,
            onShowAllChange: () => undefined
          })
        )
      )
    );
    assert.equal(html.match(/>Failed steps only</g)?.length, 1);
    assert.match(html, />Parallel branches</);
    assert.match(html, />Failed steps</);
  });
});
