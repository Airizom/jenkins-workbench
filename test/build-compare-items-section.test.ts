import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { CompareSectionStatus } from "../src/panels/buildCompare/shared/BuildCompareContracts";
import { CompareItemsSection } from "../src/panels/buildCompare/webview/components/buildCompare/shared/CompareItemsSection";

function renderEmptySection(status: CompareSectionStatus): string {
  return renderToStaticMarkup(
    createElement(CompareItemsSection<string>, {
      title: "Parameter Diff",
      summary: "Comparison summary",
      status,
      items: [],
      emptyLabel: "No differences",
      renderItem: (item) => item,
      itemKey: (item) => item
    })
  );
}

describe("CompareItemsSection", () => {
  it("shows the result empty label only for a completed empty comparison", () => {
    assert.match(renderEmptySection("empty"), /No differences/);

    for (const status of ["loading", "error", "unavailable"] as const) {
      assert.doesNotMatch(renderEmptySection(status), /No differences/);
    }
  });

  it("shows a message matching the pending or failed status", () => {
    assert.match(renderEmptySection("loading"), /Comparison is loading\./);
    assert.match(renderEmptySection("error"), /Comparison failed\./);
    assert.match(renderEmptySection("unavailable"), /Comparison data is unavailable\./);
  });
});
