import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";

class TestPosition {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

class TestRange {
  readonly start: TestPosition;
  readonly end: TestPosition;

  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new TestPosition(startLine, startCharacter);
    this.end = new TestPosition(endLine, endCharacter);
  }

  contains(position: TestPosition): boolean {
    if (position.line < this.start.line || position.line > this.end.line) {
      return false;
    }
    if (position.line === this.start.line && position.character < this.start.character) {
      return false;
    }
    if (position.line === this.end.line && position.character > this.end.character) {
      return false;
    }
    return true;
  }
}

class TestMarkdownString {
  value = "";
  isTrusted: unknown;

  constructor(value?: string) {
    this.value = value ?? "";
  }

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
  constructor(
    readonly contents: unknown,
    readonly range?: unknown
  ) {}
}

interface TestDiagnostic {
  source: string;
  message: string;
  code?: string;
  range: TestRange;
  relatedInformation?: unknown[];
}

const diagnostics: TestDiagnostic[] = [];
const docsLinks = [
  {
    label: "Unsafe docs",
    url: "command:workbench.action.reloadWindow"
  },
  {
    label: "label](command:workbench.action.reloadWindow)",
    url: "https://www.jenkins.io/doc/book/pipeline/syntax/#agent"
  }
];

const vscodeShim = {
  Position: TestPosition,
  Range: TestRange,
  Hover: TestHover,
  MarkdownString: TestMarkdownString,
  languages: {
    getDiagnostics: () => diagnostics
  }
};

vi.doMock("vscode", () => vscodeShim);
vi.doMock("../src/validation/JenkinsfileValidationDocs", () => ({
  getDocsLinksForCode: () => docsLinks
}));
const { JenkinsfileValidationHoverProvider } = (await import(
  "../src/validation/editor/JenkinsfileValidationHoverProvider"
)) as unknown as {
  JenkinsfileValidationHoverProvider: new (
    ...args: unknown[]
  ) => {
    provideHover(document: unknown, position: TestPosition): TestHover | undefined;
  };
};

describe("JenkinsfileValidationHoverProvider", () => {
  it("does not trust or emit executable Markdown links from diagnostic docs links", () => {
    const range = new TestRange(0, 0, 0, 8);
    diagnostics.splice(0, diagnostics.length, {
      source: "jenkins",
      message: "Missing agent",
      code: "missing-agent",
      range
    });

    const provider = new JenkinsfileValidationHoverProvider(
      { matches: () => true },
      { getLastValidationEnvironment: () => undefined }
    );
    const hover = provider.provideHover(
      { uri: { toString: () => "file:///Jenkinsfile" } },
      new TestPosition(0, 1)
    );

    assert.ok(hover);
    assert.equal(hover.range, range);

    const markdown = hover.contents as TestMarkdownString;
    assert.equal(markdown.isTrusted, false);
    assert.doesNotMatch(markdown.value, /<command:/);
    assert.match(markdown.value, /label\\]\(command:workbench\.action\.reloadWindow\)/);
    assert.match(markdown.value, /https:\/\/www\.jenkins\.io\/doc\/book\/pipeline\/syntax\/#agent/);
  });
});
