import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { BuildTestsSummaryViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { TestPassDonutCard } from "../src/panels/buildDetails/webview/components/buildDetails/overview/TestPassDonutCard";
import {
  describeTestOutcome,
  formatPassRate
} from "../src/panels/buildDetails/webview/components/buildDetails/testResults/testResultsUtils";

function summary(overrides: Partial<BuildTestsSummaryViewModel>): BuildTestsSummaryViewModel {
  return {
    totalCount: 926,
    failedCount: 2,
    skippedCount: 0,
    passedCount: 924,
    summaryLabel: "2 failed, 924 passed",
    hasAnyResults: true,
    hasDetailedResults: true,
    detailsUnavailable: false,
    logsIncluded: false,
    canLoadLogs: false,
    ...overrides
  };
}

describe("TestPassDonutCard", () => {
  it("uses the skipped tone when every test was skipped", () => {
    const html = renderToStaticMarkup(
      createElement(TestPassDonutCard, {
        summary: {
          totalCount: 5,
          failedCount: 0,
          skippedCount: 5,
          passedCount: 0,
          summaryLabel: "5 skipped",
          hasAnyResults: true,
          hasDetailedResults: true,
          detailsUnavailable: false,
          logsIncluded: false,
          canLoadLogs: false
        },
        onShowTests: () => {}
      })
    );

    const badge = html.match(/<span class="([^"]*)">All skipped<\/span>/);
    assert.ok(badge);
    assert.match(badge[1], /border-warning-border/);
    assert.doesNotMatch(badge[1], /border-success-border/);
  });

  it("never rounds a pass rate up to 100% while tests failed", () => {
    assert.equal(formatPassRate(99.96, 1), "99.9");
    assert.equal(formatPassRate(99.78, 2), "99.7");
    assert.equal(formatPassRate(98.7, 5), "98");
    assert.equal(formatPassRate(99.6, 0), "100");
    assert.equal(formatPassRate(0, 3), "0");
    assert.equal(formatPassRate(0.1, 999), "<1");
  });

  it("leaves skipped tests out of the pass rate so a clean run reads 100%", () => {
    const html = renderToStaticMarkup(
      createElement(TestPassDonutCard, {
        summary: summary({ failedCount: 0, skippedCount: 6, passedCount: 920 }),
        onShowTests: () => {}
      })
    );

    assert.match(html, />100% passed</);
    assert.match(html, />100%</);
    assert.doesNotMatch(html, /99%/);
  });

  it("leads with the failed count when tests failed", () => {
    const html = renderToStaticMarkup(
      createElement(TestPassDonutCard, { summary: summary({}), onShowTests: () => {} })
    );

    assert.match(html, /class="[^"]*text-failure[^"]*">2 failed<\/span>/);
    assert.match(html, /of 926 · 99\.7% passed/);
    assert.doesNotMatch(html, /100%/);
    assert.doesNotMatch(html, /[^.]\b99% passed/);
    assert.match(html, /View failed tests/);
  });

  it("keeps the link's visible text as its accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(TestPassDonutCard, {
        summary: summary({ failedCount: 0, passedCount: 926 }),
        onShowTests: () => {}
      })
    );

    assert.match(html, /View test results/);
    assert.doesNotMatch(html, /aria-label="Open the Tests tab"/);
    assert.match(html, />100% passed</);
  });
});

describe("describeTestOutcome", () => {
  it("computes the pass rate over executed tests and keeps tone driven by failures", () => {
    const clean = describeTestOutcome(
      summary({ failedCount: 0, skippedCount: 6, passedCount: 920 })
    );
    assert.equal(clean.passRate, 100);
    assert.equal(clean.passRateLabel, "100% passed");
    assert.equal(clean.countsLabel, "920 passed · 6 skipped");
    assert.equal(clean.tone, "passed");

    const failing = describeTestOutcome(summary({ skippedCount: 6, passedCount: 918 }));
    assert.equal(failing.passRateLabel, "99.7% passed");
    assert.equal(failing.countsLabel, "2 failed of 926 tests");
    assert.equal(failing.tone, "failed");

    const skipped = describeTestOutcome(
      summary({ totalCount: 5, failedCount: 0, skippedCount: 5, passedCount: 0 })
    );
    assert.equal(skipped.passRate, undefined);
    assert.equal(skipped.passRateLabel, "All skipped");
    assert.equal(skipped.countsLabel, "5 skipped");
    assert.equal(skipped.tone, "skipped");
  });
});
