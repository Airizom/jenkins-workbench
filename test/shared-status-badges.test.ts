import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { NodeStatusBadge } from "../src/panels/shared/webview/components/NodeStatusBadge";
import { SeverityBadge } from "../src/panels/shared/webview/components/SeverityBadge";

describe("shared status badges", () => {
  it("preserves the node status label and resolved classes", () => {
    const html = renderToStaticMarkup(
      createElement(NodeStatusBadge, {
        label: "Online",
        statusClass: "online",
        className: "custom-node-class"
      })
    );

    assert.match(html, />Online</);
    assert.match(html, /border-success-border/);
    assert.match(html, /custom-node-class/);
  });

  it("preserves the severity label and resolved classes", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityBadge, {
        label: "Critical",
        severity: "critical",
        className: "custom-severity-class"
      })
    );

    assert.match(html, />Critical</);
    assert.match(html, /border-failure-border/);
    assert.match(html, /custom-severity-class/);
  });
});
