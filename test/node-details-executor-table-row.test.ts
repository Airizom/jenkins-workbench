import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { ExecutorTableRow } from "../src/panels/nodeDetails/webview/components/nodeDetails/ExecutorTableRow";

function renderRow(entry: Parameters<typeof ExecutorTableRow>[0]["entry"]): string {
  return renderToStaticMarkup(
    createElement(
      "table",
      null,
      createElement(
        "tbody",
        null,
        createElement(ExecutorTableRow, { entry, onOpenExternal: () => undefined })
      )
    )
  );
}

describe("ExecutorTableRow", () => {
  it("does not label a busy executor without work as idle", () => {
    const html = renderRow({ id: "0", statusLabel: "Busy", isIdle: false });

    assert.doesNotMatch(html, />Idle</);
    assert.match(html, />Busy</);
  });

  it("falls back to Busy when a busy executor has no status label", () => {
    const html = renderRow({ id: "0", statusLabel: "", isIdle: false });

    assert.doesNotMatch(html, />Idle</);
    assert.match(html, />Busy</);
  });

  it("labels idle executors as idle", () => {
    const html = renderRow({ id: "0", statusLabel: "Idle", isIdle: true });

    assert.match(html, />Idle</);
  });
});
