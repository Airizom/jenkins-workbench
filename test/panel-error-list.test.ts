import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { PanelErrorList } from "../src/panels/shared/webview/components/PanelErrorList";

describe("PanelErrorList", () => {
  for (const variant of ["alert", "card"] as const) {
    it(`puts the id on the outer element in ${variant} mode`, () => {
      const html = renderToStaticMarkup(
        createElement(PanelErrorList, { errors: ["Failure"], variant, id: "panel-errors" })
      );

      assert.match(html, /^<div\b[^>]*\bid="panel-errors"/);
    });
  }
});
