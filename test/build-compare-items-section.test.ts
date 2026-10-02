import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { CompareSectionStatus } from "../src/panels/buildCompare/shared/BuildCompareContracts";
import { CompareItemsSection } from "../src/panels/buildCompare/webview/components/buildCompare/shared/CompareItemsSection";

function renderSection(status: CompareSectionStatus, items: string[] = []): string {
  return renderToStaticMarkup(
    createElement(CompareItemsSection<string>, {
      title: "Parameter Diff",
      summary: "Comparison summary",
      detail: "Why it looks this way",
      status,
      items,
      renderItems: (visible) => visible.join(", ")
    })
  );
}

describe("CompareItemsSection", () => {
  it("renders an empty section as a compact heading with its summary, not an empty-state box", () => {
    for (const status of ["empty", "loading", "error", "unavailable"] as const) {
      const html = renderSection(status);
      assert.match(html, /Comparison summary/);
      assert.match(html, /Why it looks this way/);
      // Nothing to expand: no disclosure button and no placeholder copy.
      assert.doesNotMatch(html, /<button/);
      assert.doesNotMatch(html, /Comparison (is loading|failed|data is unavailable)\./);
    }
  });

  it("renders the items behind a disclosure when there are any", () => {
    const html = renderSection("available", ["alpha", "beta"]);
    assert.match(html, /alpha, beta/);
    assert.match(html, /<h3[^>]*><button[^>]*aria-expanded="true"/);
  });
});
