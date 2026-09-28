import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { QueueWorkItemViewModel } from "../src/shared/queueWork/QueueWorkContracts";
import { QueueWorkItemRow } from "../src/panels/shared/webview/components/queueWork/QueueWorkItemRow";

describe("QueueWorkItemRow", () => {
  it("gives each default Open in Jenkins button an item-specific accessible name", () => {
    const items: QueueWorkItemViewModel[] = ["Build Alpha", "Build Beta"].map((name, index) => ({
      id: index,
      name,
      position: index + 1,
      statusLabel: "Queued",
      queuedForLabels: [],
      taskUrl: `https://jenkins.example/queue/item/${index}/`,
      blocked: false,
      buildable: true,
      stuck: false
    }));
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        ...items.map((item) =>
          createElement(QueueWorkItemRow, {
            key: item.id,
            item,
            onOpenExternal: () => {}
          })
        )
      )
    );

    assert.match(
      html,
      /<button[^>]*aria-label="Open in Jenkins: Build Alpha"[^>]*>Open in Jenkins<\/button>/
    );
    assert.match(
      html,
      /<button[^>]*aria-label="Open in Jenkins: Build Beta"[^>]*>Open in Jenkins<\/button>/
    );
  });

  it("labels unlabeled work as Any node, truncates names with a title, and uses the middle-dot separator", () => {
    const html = renderToStaticMarkup(
      createElement(QueueWorkItemRow, {
        item: {
          id: 1,
          name: "folder/very-long-job-name",
          position: 2,
          statusLabel: "Queued",
          queuedForLabels: [],
          queuedDurationLabel: "3 min",
          blocked: false,
          buildable: true,
          stuck: false
        },
        onOpenExternal: () => {}
      })
    );

    assert.match(html, />Any node</);
    assert.match(html, /class="[^"]*truncate[^"]*" title="folder\/very-long-job-name"/);
    assert.match(html, / · 3 min/);
  });
});
