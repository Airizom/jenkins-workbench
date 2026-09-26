import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

class TestMarkdownString {
  value = "";

  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }

  appendText(value: string): this {
    this.value += value;
    return this;
  }
}

class TestHover {
  constructor(readonly contents: TestMarkdownString) {}
}

vi.doMock("vscode", () => ({
  MarkdownString: TestMarkdownString,
  Hover: TestHover,
  Range: class {
    constructor(
      readonly start: unknown,
      readonly end: unknown
    ) {}
  }
}));
vi.doMock("../src/jenkinsfile/JenkinsfileContextAnalyzer", () => ({
  analyzeJenkinsfileContext: () => ({
    identifier: { name: "echo", start: 0, end: 4 },
    isStepAllowed: true,
    canSuggestStep: true
  })
}));

const { JenkinsfileStepHoverProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileStepHoverProvider"
);

describe("JenkinsfileStepHoverProvider", () => {
  it("renders HTML-like metadata literally and keeps backticks inside signature code spans", async () => {
    const step = {
      name: "echo",
      displayName: "<i>example</i> & more",
      signatures: [
        {
          label: "echo(`value`)",
          parameters: [{ name: "message", description: "<b>text</b>" }]
        },
        { label: "`edge`", parameters: [] }
      ]
    };
    const provider = new JenkinsfileStepHoverProvider(
      { isEnabled: () => true } as never,
      { matches: () => true } as never,
      {
        getCatalogForDocument: async () => ({
          kind: "fallback-no-environment",
          catalog: { steps: new Map([["echo", step]]) }
        })
      } as never
    );

    const hover = await provider.provideHover(
      { positionAt: (offset: number) => offset } as never,
      { line: 0, character: 1 } as never
    );

    assert.ok(hover);
    const markdown = (hover.contents as unknown as TestMarkdownString).value;
    assert.match(markdown, /&lt;i&gt;example&lt;\/i&gt; &amp; more/);
    assert.match(markdown, /- ``echo\(`value`\)``\n/);
    assert.match(markdown, /- `` `edge` ``\n/);
    assert.match(markdown, /message: &lt;b&gt;text&lt;\/b&gt;/);
    assert.doesNotMatch(markdown, /<\/?[ib]>/);
  });
});
