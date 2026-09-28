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

  it("names the open action after the build and exposes the status as text", () => {
    const html = renderRow({
      id: "#0",
      statusLabel: "Busy",
      isIdle: false,
      workLabel: "web-app #12",
      workUrl: "https://jenkins.example/job/web-app/12/"
    });

    assert.match(html, /aria-label="Open web-app #12 in Jenkins"/);
    assert.match(html, /<span class="sr-only">Busy<\/span>/);
  });
});

describe("ExecutorTableRow cells", () => {
  it("labels a free executor on an offline node as offline", () => {
    const html = renderToStaticMarkup(
      createElement(
        "table",
        null,
        createElement(
          "tbody",
          null,
          createElement(ExecutorTableRow, {
            entry: { id: "0", statusLabel: "Idle", isIdle: true },
            isOffline: true,
            onOpenExternal: () => undefined
          })
        )
      )
    );

    assert.match(html, /<span class="sr-only">Offline<\/span>/);
    assert.match(html, />Idle</);
  });

  it("shows progress with a percent fallback label", () => {
    const html = renderRow({
      id: "0",
      statusLabel: "Busy",
      isIdle: false,
      progressPercent: 42,
      workDurationLabel: "3m"
    });

    assert.match(html, />42%</);
    assert.match(html, />3m</);
  });

  it("prefers an explicit progress label", () => {
    const html = renderRow({
      id: "0",
      statusLabel: "Busy",
      isIdle: false,
      progressPercent: 42,
      progressLabel: "about 2m left"
    });

    assert.match(html, />about 2m left</);
  });

  it("uses dashes when duration, progress, and link are unavailable", () => {
    const html = renderRow({ id: "0", statusLabel: "Idle", isIdle: true });

    assert.equal(html.match(/>—</g)?.length, 3);
    assert.doesNotMatch(html, /<button/);
  });
});
