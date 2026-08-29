import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { resolveCoverageStatusBadgeClass } from "../src/panels/shared/TestStatusStyles";
import { ToneBadge } from "../src/panels/shared/webview/components/ToneBadge";
import {
  resolveNodeStatusBadgeClass,
  resolveSeverityBadgeClass
} from "../src/panels/shared/webview/lib/statusStyles";

describe("shared status badges", () => {
  it("renders coverage status classes through the shared badge", () => {
    const html = renderToStaticMarkup(
      createElement(ToneBadge, {
        label: "Passed",
        className: resolveCoverageStatusBadgeClass("success")
      })
    );

    assert.match(html, />Passed</);
    assert.match(html, /border-success-border/);
  });

  it("renders node status classes through the shared badge", () => {
    const html = renderToStaticMarkup(
      createElement(ToneBadge, {
        label: "Online",
        className: resolveNodeStatusBadgeClass("online")
      })
    );

    assert.match(html, />Online</);
    assert.match(html, /border-success-border/);
  });

  it("renders severity classes through the shared badge", () => {
    const html = renderToStaticMarkup(
      createElement(ToneBadge, {
        label: "Critical",
        className: resolveSeverityBadgeClass("critical")
      })
    );

    assert.match(html, />Critical</);
    assert.match(html, /border-failure-border/);
  });
});
