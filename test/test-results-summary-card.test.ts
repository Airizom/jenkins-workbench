import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { TestResultsSummaryCard } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/TestResultsSummaryCard";

describe("TestResultsSummaryCard", () => {
  it("uses the test distribution percentage for the badge and meter", () => {
    const html = renderToStaticMarkup(
      createElement(TestResultsSummaryCard, {
        summary: {
          totalCount: 4,
          failedCount: 1,
          skippedCount: 0,
          passedCount: 3,
          summaryLabel: "3 passed, 1 failed",
          hasAnyResults: true,
          hasDetailedResults: true,
          detailsUnavailable: false,
          logsIncluded: false,
          canLoadLogs: false
        }
      })
    );

    assert.match(html, />75% passed</);
    assert.match(html, /aria-label="75% tests passed"/);
    assert.match(html, /aria-valuenow="75"/);
  });
});
