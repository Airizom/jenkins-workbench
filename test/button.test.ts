import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Button } from "../src/panels/shared/webview/components/ui/button";

describe("Button", () => {
  it("keeps an explicit type on a slotted button inside a form", () => {
    const html = renderToStaticMarkup(
      createElement(
        "form",
        null,
        createElement(
          Button,
          { asChild: true, type: "button" },
          // biome-ignore lint/a11y/useButtonType: The child intentionally omits type to test forwarding from Button.
          createElement("button", null, "Cancel")
        )
      )
    );

    assert.match(html, /<form><button\b[^>]*\btype="button"[^>]*>Cancel<\/button><\/form>/);
  });
});
