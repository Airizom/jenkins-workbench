import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { LabelChips } from "../src/panels/nodeDetails/webview/components/nodeDetails/LabelChips";

describe("LabelChips", () => {
  it("describes an empty list as no shared labels without ruling out node-specific targeting", () => {
    const html = renderToStaticMarkup(createElement(LabelChips, { labels: [] }));

    assert.match(html, /No shared labels assigned/);
    assert.match(html, /node-specific label/);
    assert.doesNotMatch(html, /cannot target this node/);
  });
});
