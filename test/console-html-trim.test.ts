import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConsoleHtmlModel } from "../src/panels/buildDetails/webview/lib/consoleHtml";
import { trimConsoleHtmlModelToTail } from "../src/panels/buildDetails/webview/lib/consoleHtml";

describe("trimConsoleHtmlModelToTail", () => {
  it("trims inside a wrapped console element instead of dropping it", () => {
    const model: ConsoleHtmlModel = {
      nodes: [
        {
          type: "element",
          tag: "span",
          attrs: { className: "jenkins-annotated" },
          children: [{ type: "text", value: "abcdefghij" }]
        }
      ],
      text: "abcdefghij"
    };

    const trimmed = trimConsoleHtmlModelToTail(model, 4);

    assert.equal(trimmed.text, "ghij");
    assert.deepEqual(trimmed.nodes, [
      {
        type: "element",
        tag: "span",
        attrs: { className: "jenkins-annotated" },
        children: [{ type: "text", value: "ghij" }]
      }
    ]);
  });

  it("recurses through nested children at the trim boundary", () => {
    const model: ConsoleHtmlModel = {
      nodes: [
        {
          type: "element",
          tag: "span",
          attrs: {},
          children: [
            { type: "text", value: "abc" },
            {
              type: "element",
              tag: "b",
              attrs: {},
              children: [{ type: "text", value: "defghi" }]
            }
          ]
        }
      ],
      text: "abcdefghi"
    };

    const trimmed = trimConsoleHtmlModelToTail(model, 4);

    assert.equal(trimmed.text, "fghi");
    assert.deepEqual(trimmed.nodes, [
      {
        type: "element",
        tag: "span",
        attrs: {},
        children: [
          {
            type: "element",
            tag: "b",
            attrs: {},
            children: [{ type: "text", value: "fghi" }]
          }
        ]
      }
    ]);
  });
});
