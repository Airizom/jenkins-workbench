import assert from "node:assert/strict";
import { isValidElement, type MouseEvent as ReactMouseEvent } from "react";
import { describe, it } from "vitest";
import {
  parseConsoleHtml,
  renderConsoleHtmlWithHighlights,
  sanitizeConsoleExternalUrl
} from "../src/panels/buildDetails/webview/lib/consoleHtml";

describe("sanitizeConsoleExternalUrl", () => {
  it("allows absolute http and https links", () => {
    assert.equal(
      sanitizeConsoleExternalUrl("https://jenkins.example.com/job/example/1/"),
      "https://jenkins.example.com/job/example/1/"
    );
    assert.equal(
      sanitizeConsoleExternalUrl("http://jenkins.example.com/job/example/1/"),
      "http://jenkins.example.com/job/example/1/"
    );
  });

  it("rejects relative links instead of resolving them against the webview origin", () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
      location: { href: "https://webview.example.invalid/index.html" }
    } as Window & typeof globalThis;
    try {
      assert.equal(sanitizeConsoleExternalUrl("/job/example/1/"), undefined);
      assert.equal(sanitizeConsoleExternalUrl("job/example/1/"), undefined);
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it("rejects non-http external links", () => {
    assert.equal(sanitizeConsoleExternalUrl("javascript:alert(1)"), undefined);
    assert.equal(sanitizeConsoleExternalUrl("file:///tmp/console.log"), undefined);
  });

  it("stores one sanitized URL attribute and opens that href", () => {
    const originalDOMParser = globalThis.DOMParser;
    const originalNode = globalThis.Node;
    const inputUrl = "https://jenkins.example.com/job/../build/1";
    const safeUrl = "https://jenkins.example.com/build/1";

    class TestDOMParser {
      parseFromString(): Document {
        const textNode = { nodeType: 3, textContent: "Build" } as ChildNode;
        const anchor = {
          nodeType: 1,
          tagName: "A",
          childNodes: [textNode],
          getAttribute: (name: string) => (name === "href" ? inputUrl : null)
        } as unknown as HTMLElement;
        return { body: { childNodes: [anchor] } } as unknown as Document;
      }
    }

    globalThis.DOMParser = TestDOMParser as unknown as typeof DOMParser;
    globalThis.Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1
    } as unknown as typeof Node;

    try {
      const model = parseConsoleHtml(`<a href="${inputUrl}">Build</a>`);
      const modelNode = model.nodes[0];
      assert.ok(modelNode?.type === "element");
      assert.deepEqual(modelNode.attrs, { href: safeUrl });

      let openedUrl: string | undefined;
      const renderedNode = renderConsoleHtmlWithHighlights(model, [], -1, (url) => {
        openedUrl = url;
      })[0];
      assert.ok(isValidElement<Record<string, unknown>>(renderedNode));
      assert.equal(renderedNode.props.href, safeUrl);
      assert.equal("data-external-url" in renderedNode.props, false);

      let defaultPrevented = false;
      const onClick = renderedNode.props.onClick;
      assert.equal(typeof onClick, "function");
      (onClick as (event: ReactMouseEvent<HTMLAnchorElement>) => void)({
        preventDefault: () => {
          defaultPrevented = true;
        }
      } as ReactMouseEvent<HTMLAnchorElement>);

      assert.equal(defaultPrevented, true);
      assert.equal(openedUrl, safeUrl);
    } finally {
      globalThis.DOMParser = originalDOMParser;
      globalThis.Node = originalNode;
    }
  });
});
