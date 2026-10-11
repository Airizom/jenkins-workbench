import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { renderLoadingSkeletonHtml } from "../src/panels/shared/webview/LoadingSkeletonHtml";
import {
  LoadingSkeleton,
  type LoadingSkeletonProps
} from "../src/panels/shared/webview/components/ui/loading-skeleton";

describe("LoadingSkeleton", () => {
  it("renders the shared skeleton markup with forwarded attributes", () => {
    const html = renderToStaticMarkup(
      createElement(LoadingSkeleton, { className: "gate", "aria-busy": true })
    );

    assert.equal(
      html,
      `<div class="gate" aria-busy="true">${renderLoadingSkeletonHtml("build")}</div>`
    );
  });

  it("rejects children and caller-supplied inner HTML at compile time", () => {
    // @ts-expect-error children would conflict with the skeleton's inner HTML
    const withChildren: LoadingSkeletonProps = { children: "Loading" };
    // @ts-expect-error the skeleton owns its inner HTML
    const withHtml: LoadingSkeletonProps = { dangerouslySetInnerHTML: { __html: "" } };

    assert.ok(withChildren);
    assert.ok(withHtml);
  });
});
