import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

class TestCompletionItem {
  range?: unknown;
  detail?: string;
  documentation?: unknown;
  insertText?: unknown;
  sortText?: string;
  tags?: unknown[];

  constructor(
    readonly label: string,
    readonly kind: number
  ) {}
}

class TestCompletionList {
  constructor(
    readonly items: TestCompletionItem[],
    readonly isIncomplete: boolean
  ) {}
}

class TestRange {
  constructor(
    readonly start: unknown,
    readonly end: unknown
  ) {}
}

class TestSnippetString {
  constructor(readonly value = "") {}
}

vi.doMock("vscode", () => ({
  CompletionItem: TestCompletionItem,
  CompletionItemKind: { Function: 3 },
  CompletionList: TestCompletionList,
  MarkdownString: class {},
  Range: TestRange,
  SnippetString: TestSnippetString
}));
vi.doMock("../src/jenkinsfile/JenkinsfileContextAnalyzer", () => ({
  analyzeJenkinsfileContext: () => ({
    canSuggestStep: true,
    hasNodeContext: true
  })
}));

const { JenkinsfileCompletionProvider } = await import(
  "../src/jenkinsfile/editor/JenkinsfileCompletionProvider"
);

describe("JenkinsfileCompletionProvider", () => {
  it("ranks advanced steps later without marking them deprecated", async () => {
    const steps = new Map([
      [
        "ordinary",
        {
          name: "ordinary",
          displayName: "Ordinary",
          requiresNodeContext: false,
          isAdvanced: false,
          signatures: []
        }
      ],
      [
        "advanced",
        {
          name: "advanced",
          displayName: "Advanced",
          requiresNodeContext: false,
          isAdvanced: true,
          signatures: []
        }
      ]
    ]);
    const provider = new JenkinsfileCompletionProvider(
      { isEnabled: () => true } as never,
      { matches: () => true } as never,
      {
        getCatalogForDocument: async () => ({ catalog: { steps } })
      } as never
    );
    const position = { line: 0, character: 0 };

    const result = await provider.provideCompletionItems(
      { positionAt: () => position } as never,
      position as never
    );

    assert.ok(result);
    const ordinary = result.items.find((item) => item.label === "ordinary");
    const advanced = result.items.find((item) => item.label === "advanced");
    assert.equal(ordinary?.sortText, "a:ordinary");
    assert.equal(advanced?.sortText, "z:advanced");
    assert.equal(advanced?.tags, undefined);
  });
});
