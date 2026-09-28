import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { BuildTestsSummaryViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  formatPassRate,
  TestPassDonutCard
} from "../src/panels/buildDetails/webview/components/buildDetails/overview/TestPassDonutCard";

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

    const badge = html.match(/<span class="([^"]*)">0% passed<\/span>/);
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
