import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveConsoleAnsiClassNames } from "../src/panels/buildDetails/webview/lib/consoleAnsiStyles";
import { parseConsoleHtml } from "../src/panels/buildDetails/webview/lib/consoleHtml";

describe("resolveConsoleAnsiClassNames", () => {
  it("maps AnsiColor palette colors to ANSI indexes", () => {
    assert.deepEqual(resolveConsoleAnsiClassNames("color: #CD0000;"), ["console-ansi-fg-1"]);
    assert.deepEqual(resolveConsoleAnsiClassNames("background-color: #55FF55"), [
      "console-ansi-bg-10"
    ]);
    assert.deepEqual(resolveConsoleAnsiClassNames("color: #3465A4;"), ["console-ansi-fg-4"]);
    assert.deepEqual(resolveConsoleAnsiClassNames("color: cyan; font-weight: bold;"), [
      "console-ansi-fg-6",
      "console-ansi-bold"
    ]);
  });

  it("drops colors outside the known palettes", () => {
    assert.deepEqual(resolveConsoleAnsiClassNames("color: #123456;"), []);
    assert.deepEqual(resolveConsoleAnsiClassNames("border: 1px solid red"), []);
    assert.deepEqual(resolveConsoleAnsiClassNames(null), []);
  });
});

it("keeps span classes and adds ANSI classes when parsing console HTML", () => {
  const originalDOMParser = globalThis.DOMParser;
  const originalNode = globalThis.Node;
  const span = {
    nodeType: 1,
    tagName: "SPAN",
    childNodes: [{ nodeType: 3, textContent: "FAILED" }],
    getAttribute: (name: string) =>
      name === "class" ? "jenkins-note" : name === "style" ? "color: #CD0000;" : null
  };

  class TestDOMParser {
    parseFromString(): Document {
      return { body: { childNodes: [span] } } as unknown as Document;
    }
  }

  globalThis.DOMParser = TestDOMParser as unknown as typeof DOMParser;
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 } as unknown as typeof Node;
  try {
    const model = parseConsoleHtml("<span>FAILED</span>");
    const [node] = model.nodes;
    assert.equal(node?.type, "element");
    assert.deepEqual(node?.type === "element" ? node.attrs : undefined, {
      className: "jenkins-note console-ansi-fg-1"
    });
    assert.equal(model.text, "FAILED");
  } finally {
    globalThis.DOMParser = originalDOMParser;
    globalThis.Node = originalNode;
  }
});
