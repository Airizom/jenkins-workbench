import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  disclosureContentClassName,
  disclosureTriggerChildren,
  disclosureTriggerClassName
} from "../src/panels/shared/webview/components/ui/disclosure";

describe("disclosure helpers", () => {
  it("combines shared trigger and content classes with wrapper-specific classes", () => {
    assert.equal(
      disclosureTriggerClassName("w-full", "custom-trigger"),
      "group flex items-center justify-between text-left transition-colors cursor-pointer " +
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring " +
        "disabled:pointer-events-none disabled:opacity-50 w-full custom-trigger"
    );
    assert.equal(
      disclosureContentClassName("data-[state=open]:animate-open", "custom-content"),
      "overflow-hidden data-[state=open]:animate-open custom-content"
    );
  });

  it("adds the default chevron only when the primitive is not using asChild", () => {
    const defaultMarkup = renderToStaticMarkup(disclosureTriggerChildren("Details", false));
    const asChildMarkup = renderToStaticMarkup(
      disclosureTriggerChildren(createElement("button", { type: "button" }, "Details"), true)
    );

    assert.match(defaultMarkup, /^Details<svg/);
    assert.match(defaultMarkup, /<svg/);
    assert.equal(asChildMarkup, '<button type="button">Details</button>');
  });
});
