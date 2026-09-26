import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Progress } from "../src/panels/shared/webview/components/ui/progress";

describe("Progress", () => {
  it.each([
    { value: -10, max: 100, expectedValue: 0, expectedOffset: 100 },
    { value: 150, max: 100, expectedValue: 100, expectedOffset: 0 },
    { value: Number.NaN, max: 100, expectedValue: 0, expectedOffset: 100 },
    { value: Number.POSITIVE_INFINITY, max: 100, expectedValue: 0, expectedOffset: 100 },
    { value: 20, max: 40, expectedValue: 20, expectedOffset: 50 }
  ])(
    "keeps the accessible value and indicator aligned for $value of $max",
    ({ value, max, expectedValue, expectedOffset }) => {
      const html = renderToStaticMarkup(createElement(Progress, { value, max }));

      assert.match(html, new RegExp(`aria-valuenow="${expectedValue}"`));
      assert.match(html, new RegExp(`aria-valuemax="${max}"`));
      assert.match(html, new RegExp(`translateX\\(-${expectedOffset}%\\)`));
    }
  );
});
