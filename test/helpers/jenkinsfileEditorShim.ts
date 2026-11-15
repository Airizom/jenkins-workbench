import assert from "node:assert/strict";

/**
 * Minimal `vscode` shim for Jenkinsfile completion and hover providers. Positions are
 * `{ offset }` objects so fake documents can map them without line arithmetic.
 */
export interface TestPosition {
  offset: number;
}

export class TestRange {
  constructor(
    readonly start: TestPosition,
    readonly end: TestPosition
  ) {}

  // fallow-ignore-next-line unused-class-member -- called by providers under test
  contains(position: TestPosition): boolean {
    return this.start.offset <= position.offset && position.offset <= this.end.offset;
  }
}

class TestSnippetString {
  constructor(public value = "") {}

  appendText(text: string): this {
    this.value += text;
    return this;
  }

  appendPlaceholder(text: string): this {
    this.value += `\${${text}}`;
    return this;
  }

  appendTabstop(): this {
    this.value += "$0";
    return this;
  }
}

export class TestMarkdownString {
  constructor(public value = "") {}

  // fallow-ignore-next-line unused-class-member -- called by providers under test
  appendText(text: string): this {
    this.value += text;
    return this;
  }

  // fallow-ignore-next-line unused-class-member -- called by providers under test
  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }

  // fallow-ignore-next-line unused-class-member -- called by providers under test
  appendCodeblock(code: string, language = ""): this {
    this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    return this;
  }
}

class TestCompletionItem {
  range?: TestRange;
  detail?: string;
  documentation?: TestMarkdownString;
  insertText?: string | TestSnippetString;
  sortText?: string;
  filterText?: string;

  constructor(
    readonly label: string,
    readonly kind: number
  ) {}
}

export class TestCompletionList {
  constructor(
    readonly items: TestCompletionItem[],
    readonly isIncomplete: boolean
  ) {}
}

export class TestHover {
  constructor(
    readonly contents: TestMarkdownString | TestMarkdownString[],
    readonly range?: TestRange
  ) {}
}

export const CompletionItemKind = {
  Method: 1,
  Function: 2,
  Variable: 5,
  Module: 8,
  Property: 9,
  Keyword: 13
} as const;

export const CompletionTriggerKind = {
  Invoke: 0,
  TriggerCharacter: 1,
  TriggerForIncompleteCompletions: 2
} as const;

export const jenkinsfileEditorShim = {
  CompletionItem: TestCompletionItem,
  CompletionItemKind,
  CompletionTriggerKind,
  CompletionList: TestCompletionList,
  Hover: TestHover,
  MarkdownString: TestMarkdownString,
  Range: TestRange,
  SnippetString: TestSnippetString,
  Uri: {
    parse: (value: string) => ({
      scheme: value.slice(0, value.indexOf(":")),
      fsPath: decodeURIComponent(value.replace(/^file:\/\//, ""))
    })
  }
};

const CURSOR = "/*cursor*/";

export interface FakeDocument {
  version: number;
  getText(): string;
  offsetAt(position: TestPosition): number;
  positionAt(offset: number): TestPosition;
}

/** Builds a fake document from text containing one `CURSOR` marker. */
export function documentWithCursor(source: string): {
  document: FakeDocument;
  position: TestPosition;
  text: string;
} {
  const offset = source.indexOf(CURSOR);
  assert.notEqual(offset, -1, "missing cursor marker");
  const text = source.replace(CURSOR, "");
  return {
    text,
    position: { offset },
    document: {
      version: 1,
      getText: () => text,
      offsetAt: (position) => position.offset,
      positionAt: (value) => ({ offset: value })
    }
  };
}

export const enabledConfig = { isEnabled: () => true };
export const matchingScope = { matches: () => true };

export function snippetValue(item: TestCompletionItem | undefined): string | undefined {
  const insertText = item?.insertText;
  return typeof insertText === "string" ? insertText : insertText?.value;
}
