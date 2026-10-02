import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { BuildTestsSummaryViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { TestResultsSummaryCard } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/TestResultsSummaryCard";

function renderSummaryCard(overrides: Partial<BuildTestsSummaryViewModel>): string {
  return renderToStaticMarkup(
    createElement(TestResultsSummaryCard, {
      summary: {
        totalCount: 0,
        failedCount: 0,
        skippedCount: 0,
        passedCount: 0,
        summaryLabel: "",
        hasAnyResults: true,
        hasDetailedResults: true,
        detailsUnavailable: false,
        logsIncluded: false,
        canLoadLogs: false,
        ...overrides
      }
    })
  );
}

describe("TestResultsSummaryCard", () => {
  it("uses the executed-test pass rate for the badge and meter", () => {
    const html = renderSummaryCard({
      totalCount: 4,
      failedCount: 1,
      passedCount: 3,
      summaryLabel: "3 passed, 1 failed"
    });

    assert.match(html, />75% passed</);
    assert.match(html, /aria-label="Tests 75% passed"/);
    assert.match(html, /aria-valuenow="75"/);
  });

  it("does not report 100% passed when any test failed", () => {
    const html = renderSummaryCard({
      totalCount: 200,
      failedCount: 1,
      passedCount: 199,
      summaryLabel: "199 passed, 1 failed"
    });

    assert.doesNotMatch(html, /100% passed/);
    assert.match(html, />99\.5% passed</);
    assert.match(html, /aria-label="Tests 99\.5% passed"/);
    assert.match(html, /aria-valuenow="99\.5"/);
  });

  it("reports 100% passed only when every test passed", () => {
    const html = renderSummaryCard({
      totalCount: 200,
      passedCount: 200,
      summaryLabel: "200 passed"
    });

    assert.match(html, />100% passed</);
    assert.match(html, /aria-valuenow="100"/);
  });

  it("does not count skipped tests against a run without failures", () => {
    const html = renderSummaryCard({
      totalCount: 926,
      skippedCount: 6,
      passedCount: 920,
      summaryLabel: "920 passed, 6 skipped"
    });

    assert.match(html, />100% passed</);
    assert.doesNotMatch(html, /99%/);
    assert.match(html, /border-success-border/);
  });

  it("does not report 0% passed when at least one test passed", () => {
    const html = renderSummaryCard({
      totalCount: 1000,
      failedCount: 999,
      passedCount: 1,
      summaryLabel: "1 passed, 999 failed"
    });

    assert.doesNotMatch(html, /\b0% passed/);
    assert.match(html, />&lt;1% passed</);
    assert.match(html, /aria-valuenow="0\.1"/);
  });
});
