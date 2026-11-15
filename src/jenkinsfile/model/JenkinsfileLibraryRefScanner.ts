import type { JenkinsfileLibraryRef, JenkinsfileTextRange } from "./JenkinsfileDocumentModelTypes";
import { isIdentifierStart, isWordCharacter } from "./JenkinsfileModelArguments";

/** Upper bound on how far one `@Library(...)` or `library ...` argument list is scanned. */
const MAX_SCAN_LENGTH = 4000;

interface ScannedString {
  contentRange: JenkinsfileTextRange;
  /** Index after the closing delimiter; for unterminated strings, the line end. */
  next: number;
  terminated: boolean;
}

/**
 * Reads library names from `@Library(...)`. `openParen` indexes the `(`. The original text is
 * scanned so an unterminated string the user is still typing (which the masker blanks to the
 * end of the file) still yields a ref running to the end of its line.
 */
export function scanLibraryAnnotation(
  text: string,
  openParen: number,
  refs: JenkinsfileLibraryRef[]
): void {
  scanArguments(text, openParen, true, "annotation", refs);
}

/**
 * Reads the library name from a `library` step. `afterToken` is the index just after the
 * `library` identifier. Supports `library 'a'`, `library('a@b')`,
 * `library identifier: 'a@b', ...` and `library(identifier: 'a@b', ...)`.
 */
export function scanLibraryStep(
  text: string,
  afterToken: number,
  refs: JenkinsfileLibraryRef[]
): void {
  scanLibraryCall(text, afterToken, "step", refs);
}

/**
 * Reads the library name from `lib('a@b')` or `lib 'a'` in a declarative `libraries` block.
 * `afterToken` is the index just after the `lib` identifier.
 */
export function scanLibraryDirective(
  text: string,
  afterToken: number,
  refs: JenkinsfileLibraryRef[]
): void {
  scanLibraryCall(text, afterToken, "directive", refs);
}

function scanLibraryCall(
  text: string,
  afterToken: number,
  source: "step" | "directive",
  refs: JenkinsfileLibraryRef[]
): void {
  let index = afterToken;
  while (text[index] === " " || text[index] === "\t") {
    index += 1;
  }
  const character = text[index];
  if (character === "(") {
    scanArguments(text, index, true, source, refs);
    return;
  }
  if (character === "'" || character === '"') {
    scanArguments(text, index, false, source, refs);
    return;
  }
  if (isIdentifierStart(character)) {
    let end = index;
    while (isWordCharacter(text[end])) {
      end += 1;
    }
    while (text[end] === " " || text[end] === "\t") {
      end += 1;
    }
    if (text[end] === ":") {
      scanArguments(text, index, false, source, refs);
    }
  }
}

function scanArguments(
  text: string,
  start: number,
  parenthesized: boolean,
  source: JenkinsfileLibraryRef["source"],
  refs: JenkinsfileLibraryRef[]
): void {
  new LibraryArgumentScanner(text, start, parenthesized, source, refs).scan();
}

class LibraryArgumentScanner {
  private readonly limit: number;
  private readonly baseDepth: number;
  private readonly keySeparator: string;
  private index: number;
  private depth: number;
  private key: string | undefined;
  private keyDepth = -1;
  private argumentIndex = 0;
  private lastSignificant = "";

  constructor(
    private readonly text: string,
    start: number,
    private readonly parenthesized: boolean,
    private readonly source: JenkinsfileLibraryRef["source"],
    private readonly refs: JenkinsfileLibraryRef[]
  ) {
    this.limit = Math.min(text.length, start + MAX_SCAN_LENGTH);
    this.baseDepth = parenthesized ? 1 : 0;
    this.index = parenthesized ? start + 1 : start;
    this.depth = this.baseDepth;
    this.keySeparator = source === "annotation" ? "=" : ":";
  }

  scan(): void {
    while (this.index < this.limit) {
      if (!this.scanNext()) {
        return;
      }
    }
  }

  private scanNext(): boolean {
    const character = this.text[this.index];
    if (character === "\n") {
      if (!this.parenthesized && this.depth === 0 && this.lastSignificant !== ",") {
        return false;
      }
      this.index += 1;
      return true;
    }
    if (character === " " || character === "\t" || character === "\r") {
      this.index += 1;
      return true;
    }
    const commentEnd = this.findCommentEnd();
    if (commentEnd !== undefined) {
      this.index = commentEnd;
      return true;
    }
    if (character === "'" || character === '"') {
      return this.readString();
    }
    if (isWordCharacter(character)) {
      this.readWord();
      return true;
    }
    return this.readSymbol(character);
  }

  private findCommentEnd(): number | undefined {
    if (this.text[this.index] !== "/") {
      return undefined;
    }
    const next = this.text[this.index + 1];
    if (next === "/") {
      return findLineEnd(this.text, this.index);
    }
    if (next === "*") {
      const close = this.text.indexOf("*/", this.index + 2);
      return close < 0 ? this.limit : close + 2;
    }
    return undefined;
  }

  private isLibraryReference(): boolean {
    if (this.source === "annotation") {
      return this.key === undefined || this.key === "value";
    }
    return (
      this.key === "identifier" ||
      (this.key === undefined && this.depth === this.baseDepth && this.argumentIndex === 0)
    );
  }

  private readString(): boolean {
    const scanned = scanString(this.text, this.index);
    if (this.isLibraryReference()) {
      this.refs.push(createRef(this.text, scanned.contentRange, this.source));
      if (this.source !== "annotation") {
        return false;
      }
    }
    if (!scanned.terminated) {
      return false;
    }
    this.lastSignificant = this.text[this.index];
    this.index = scanned.next;
    return true;
  }

  private readWord(): void {
    let end = this.index;
    while (end < this.limit && isWordCharacter(this.text[end])) {
      end += 1;
    }
    let after = end;
    while (this.text[after] === " " || this.text[after] === "\t") {
      after += 1;
    }
    if (this.text[after] === this.keySeparator && this.text[after + 1] !== this.keySeparator) {
      this.key = this.text.slice(this.index, end);
      this.keyDepth = this.depth;
      this.index = after + 1;
      this.lastSignificant = this.keySeparator;
      return;
    }
    this.lastSignificant = "w";
    this.index = end;
  }

  private readSymbol(character: string): boolean {
    if (character === "(" || character === "[") {
      this.depth += 1;
    } else if (character === ")" || character === "]") {
      this.depth -= 1;
      if (this.depth < this.baseDepth || (this.parenthesized && this.depth === 0)) {
        return false;
      }
    } else if (character === ",") {
      this.advanceArgument();
    } else if (!this.parenthesized && this.depth === 0 && "{};".includes(character)) {
      return false;
    }
    this.lastSignificant = character;
    this.index += 1;
    return true;
  }

  private advanceArgument(): void {
    if (this.depth === this.keyDepth) {
      this.key = undefined;
      this.keyDepth = -1;
    }
    if (this.depth === this.baseDepth) {
      this.argumentIndex += 1;
    }
  }
}

function scanString(text: string, start: number): ScannedString {
  const quote = text[start];
  const triple = text[start + 1] === quote && text[start + 2] === quote;
  const delimiterLength = triple ? 3 : 1;
  const delimiter = quote.repeat(delimiterLength);
  const contentStart = start + delimiterLength;
  let index = contentStart;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (!triple && character === "\n") {
      break;
    }
    const interpolationEnd = findStringInterpolationEnd(text, index, quote, triple);
    if (interpolationEnd !== undefined) {
      index = interpolationEnd;
      continue;
    }
    if (text.startsWith(delimiter, index)) {
      return {
        contentRange: { start: contentStart, end: index },
        next: index + delimiterLength,
        terminated: true
      };
    }
    index += 1;
  }
  const lineEnd = findLineEnd(text, contentStart);
  const end = text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
  return {
    contentRange: { start: contentStart, end: Math.max(contentStart, end) },
    next: lineEnd,
    terminated: false
  };
}

function findStringInterpolationEnd(
  text: string,
  index: number,
  quote: string,
  triple: boolean
): number | undefined {
  if (quote !== '"' || text[index] !== "$" || text[index + 1] !== "{") {
    return undefined;
  }
  const close = text.indexOf("}", index + 2);
  const lineEnd = findLineEnd(text, index);
  return close >= 0 && (triple || close < lineEnd) ? close + 1 : undefined;
}

function createRef(
  text: string,
  range: JenkinsfileTextRange,
  source: JenkinsfileLibraryRef["source"]
): JenkinsfileLibraryRef {
  const content = text.slice(range.start, range.end);
  const at = content.indexOf("@");
  const name = at < 0 ? content : content.slice(0, at);
  return {
    name,
    ref: at < 0 ? undefined : content.slice(at + 1),
    range,
    nameRange: { start: range.start, end: range.start + name.length },
    source
  };
}

function findLineEnd(text: string, index: number): number {
  const lineEnd = text.indexOf("\n", index);
  return lineEnd < 0 ? text.length : lineEnd;
}
