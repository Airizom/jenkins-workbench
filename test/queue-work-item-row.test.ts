import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { QueueWorkItemViewModel } from "../src/shared/queueWork/QueueWorkContracts";
import { QueueWorkItemRow } from "../src/panels/shared/webview/components/queueWork/QueueWorkItemRow";

describe("QueueWorkItemRow", () => {
  it("gives each default Open button an item-specific accessible name", () => {
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

    assert.match(html, /<button[^>]*aria-label="Open Build Alpha in Jenkins"[^>]*>Open<\/button>/);
    assert.match(html, /<button[^>]*aria-label="Open Build Beta in Jenkins"[^>]*>Open<\/button>/);
  });
});
