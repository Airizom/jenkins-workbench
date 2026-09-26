import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { TestPassDonutCard } from "../src/panels/buildDetails/webview/components/buildDetails/overview/TestPassDonutCard";

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
});
