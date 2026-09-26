import assert from "node:assert/strict";
import { it } from "vitest";
import {
  parseConsoleHtml,
  renderConsoleHtmlWithHighlights
} from "../src/panels/buildDetails/webview/lib/consoleHtml";

it("omits non-visible HTML subtrees from console text and rendered nodes", () => {
  const originalDOMParser = globalThis.DOMParser;
  const originalNode = globalThis.Node;
  const text = (value: string) => ({ nodeType: 3, textContent: value });
  const element = (tagName: string, ...childNodes: object[]) => ({
    nodeType: 1,
    tagName,
    childNodes
  });

  class TestDOMParser {
    parseFromString(): Document {
      return {
        body: {
          childNodes: [
            element("STYLE", text(".x{color:red}")),
            element("SCRIPT", text("alert('hidden')")),
            element(
              "DIV",
              element("TEMPLATE", text("template text")),
              element("NOSCRIPT", text("fallback text")),
              text("Error")
            )
          ]
        }
      } as unknown as Document;
    }
  }

  globalThis.DOMParser = TestDOMParser as unknown as typeof DOMParser;
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 } as unknown as typeof Node;

  try {
    const model = parseConsoleHtml(
      "<style>.x{color:red}</style><script>alert('hidden')</script>Error"
    );
    assert.equal(model.text, "Error");
    assert.deepEqual(model.nodes, [{ type: "text", value: "Error" }]);
    assert.deepEqual(renderConsoleHtmlWithHighlights(model, [], -1), ["Error"]);
  } finally {
    globalThis.DOMParser = originalDOMParser;
    globalThis.Node = originalNode;
  }
});
