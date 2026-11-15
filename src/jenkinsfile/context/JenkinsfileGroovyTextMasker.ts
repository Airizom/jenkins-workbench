type GroovyMaskMode =
  | { type: "single" }
  | { type: "double" }
  | { type: "triple-single" }
  | { type: "triple-double" }
  | { type: "slashy" }
  | { type: "dollar-slashy" }
  | { type: "interpolation"; depth: number };

/** Previous significant code token, which Groovy's lexer uses to tell a slashy literal from division. */
type PreviousToken =
  | { kind: "start" | "newline" | "literal" }
  | { kind: "symbol"; value: string; end: number }
  // `member` marks a property name after `.`, which is never a keyword there.
  | { kind: "word"; value: string; end: number; member: boolean };

const LITERAL_TOKEN: PreviousToken = { kind: "literal" };

/** Cursor offsets as a half-open range; `end` is `text.length + 1` when it runs to the end. */
interface GroovyOffsetRange {
  start: number;
  end: number;
}

interface GroovyMaskResult {
  maskedText: string;
  /**
   * Cursor offsets (`0..text.length`) inside a string literal or comment, in order. Interpolated
   * code (`"${...}"`) counts as code, and so does the offset just after a closing delimiter.
   */
  nonCodeRanges: GroovyOffsetRange[];
}

export function maskGroovyText(text: string): string {
  return scanGroovyText(text);
}

/** Masks like {@link maskGroovyText} and also records which cursor offsets are not code. */
export function maskGroovyTextWithNonCodeRanges(text: string): GroovyMaskResult {
  const recorder = new NonCodeRangeRecorder(text.length);
  const maskedText = scanGroovyText(text, recorder);
  return { maskedText, nonCodeRanges: recorder.finish() };
}

/**
 * Records, for each cursor offset in order, whether an identifier character typed there would
 * be masked. The scan marks each offset as it reaches it; a branch that consumes a
 * multi-character token (a comment opener, triple quote, `${`, or escape) marks the offsets
 * inside that token itself.
 */
class NonCodeRangeRecorder {
  private readonly ranges: GroovyOffsetRange[] = [];
  private openStart: number | undefined;
  private nextOffset = 0;

  constructor(private readonly textLength: number) {}

  mark(offset: number, inside: boolean): void {
    if (offset < this.nextOffset || offset > this.textLength) {
      return;
    }
    this.nextOffset = offset + 1;
    if (inside) {
      this.openStart ??= offset;
    } else if (this.openStart !== undefined) {
      this.ranges.push({ start: this.openStart, end: offset });
      this.openStart = undefined;
    }
  }

  finish(): GroovyOffsetRange[] {
    if (this.openStart !== undefined) {
      this.ranges.push({ start: this.openStart, end: this.textLength + 1 });
      this.openStart = undefined;
    }
    return this.ranges;
  }
}

function scanGroovyText(text: string, recorder?: NonCodeRangeRecorder): string {
  const chars = text.split("");
  let index = 0;
  const modeStack: GroovyMaskMode[] = [];
  let inLineComment = false;
  let inBlockComment = false;
  // Open code brackets; newlines inside parentheses or lists do not end statements.
  const brackets: string[] = [];
  // Comments never change it, so they cannot make division look like a slashy literal.
  let previousToken: PreviousToken = { kind: "start" };

  while (index < chars.length) {
    const currentMode = modeStack[modeStack.length - 1];
    const character = text[index];
    const next = text[index + 1];
    const nextTwo = text[index + 2];
    recorder?.mark(index, inLineComment || inBlockComment || isNonCodeMode(currentMode));

    if (inLineComment) {
      if (character !== "\n") {
        chars[index] = " ";
      } else {
        inLineComment = false;
      }
      index += 1;
      continue;
    }

    if (inBlockComment) {
      chars[index] = maskCharacter(character);
      if (character === "*" && next === "/") {
        chars[index + 1] = " ";
        recorder?.mark(index + 1, true);
        inBlockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (!currentMode || currentMode.type === "interpolation") {
      if (character === "/" && next === "/") {
        chars[index] = " ";
        chars[index + 1] = " ";
        // Between the slashes, a typed character would follow a lone `/`.
        recorder?.mark(index + 1, canStartSlashyString(previousToken));
        inLineComment = true;
        index += 2;
        continue;
      }

      if (character === "/" && next === "*") {
        chars[index] = " ";
        chars[index + 1] = " ";
        recorder?.mark(index + 1, canStartSlashyString(previousToken));
        inBlockComment = true;
        index += 2;
        continue;
      }

      const nextIndex = enterStringMode(text, chars, index, modeStack, previousToken, recorder);
      if (nextIndex !== undefined) {
        index = nextIndex;
        continue;
      }
    }

    if (supportsInterpolation(currentMode) && character === "$" && next === "{") {
      index = enterInterpolation(chars, index, modeStack, recorder);
      brackets.push("{");
      previousToken = { kind: "symbol", value: "{", end: index - 1 };
      continue;
    }

    if (isQuotedMode(currentMode)) {
      const quote =
        currentMode.type === "single" || currentMode.type === "triple-single" ? "'" : '"';
      chars[index] = maskCharacter(character);
      if (character === "\\") {
        recorder?.mark(index + 1, true);
        index = maskEscapedCharacter(text, chars, index);
        continue;
      }
      if (currentMode.type === "single" || currentMode.type === "double") {
        if (character === quote) {
          modeStack.pop();
          previousToken = LITERAL_TOKEN;
        }
        index += 1;
        continue;
      }
      if (character === quote && next === quote && nextTwo === quote) {
        chars[index + 1] = " ";
        chars[index + 2] = " ";
        recorder?.mark(index + 1, true);
        recorder?.mark(index + 2, true);
        modeStack.pop();
        previousToken = LITERAL_TOKEN;
        index += 3;
        continue;
      }
      index += 1;
      continue;
    }

    if (currentMode?.type === "slashy" || currentMode?.type === "dollar-slashy") {
      chars[index] = maskCharacter(character);
      if (currentMode.type === "slashy" && character === "\\") {
        recorder?.mark(index + 1, true);
        index = maskEscapedCharacter(text, chars, index);
        continue;
      }
      if (
        currentMode.type === "dollar-slashy" &&
        character === "$" &&
        (next === "$" || next === "/")
      ) {
        chars[index + 1] = " ";
        recorder?.mark(index + 1, true);
        index += 2;
        continue;
      }
      if (currentMode.type === "slashy" && character === "/") {
        modeStack.pop();
        previousToken = LITERAL_TOKEN;
      } else if (currentMode.type === "dollar-slashy" && character === "/" && next === "$") {
        chars[index + 1] = " ";
        recorder?.mark(index + 1, true);
        modeStack.pop();
        previousToken = LITERAL_TOKEN;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    // A backslash-newline continues the statement on the next line.
    if (character === "\\" && (next === "\n" || (next === "\r" && nextTwo === "\n"))) {
      recorder?.mark(index + 1, false);
      if (next === "\r") {
        recorder?.mark(index + 2, false);
      }
      index += next === "\n" ? 2 : 3;
      continue;
    }
    previousToken = nextPreviousToken(previousToken, character, index, brackets);
    trackBracket(brackets, character);
    if (currentMode?.type === "interpolation") {
      if (character === "{") {
        currentMode.depth += 1;
      } else if (character === "}") {
        currentMode.depth -= 1;
        if (currentMode.depth === 0) {
          modeStack.pop();
        }
      }
    }
    index += 1;
  }

  recorder?.mark(
    text.length,
    inLineComment || inBlockComment || isNonCodeMode(modeStack[modeStack.length - 1])
  );
  return chars.join("");
}

function isNonCodeMode(mode: GroovyMaskMode | undefined): boolean {
  return mode !== undefined && mode.type !== "interpolation";
}

function supportsInterpolation(mode: GroovyMaskMode | undefined): boolean {
  return (
    mode?.type === "double" ||
    mode?.type === "triple-double" ||
    mode?.type === "slashy" ||
    mode?.type === "dollar-slashy"
  );
}

function nextPreviousToken(
  previous: PreviousToken,
  character: string,
  index: number,
  brackets: readonly string[]
): PreviousToken {
  if (/\s/.test(character)) {
    // Inside parentheses or lists Groovy ignores newlines.
    const newlineEndsStatement = brackets.length === 0 || brackets[brackets.length - 1] === "{";
    return character === "\n" && newlineEndsStatement ? { kind: "newline" } : previous;
  }
  // Java identifier parts also include currency symbols, connector punctuation,
  // and ignorable format characters; surrogate halves cover supplementary planes.
  if (/[\p{ID_Continue}\p{Sc}\p{Pc}\p{Cf}\uD800-\uDFFF]/u.test(character)) {
    if (previous.kind === "word" && previous.end === index - 1) {
      return { ...previous, value: previous.value + character, end: index };
    }
    const member = previous.kind === "symbol" && previous.value === ".";
    return { kind: "word", value: character, end: index, member };
  }
  // `++` and `--` end an operand (`count++ / total`), like Groovy's INC/DEC tokens.
  const repeated =
    "+-".includes(character) &&
    previous.kind === "symbol" &&
    previous.value === character &&
    previous.end === index - 1;
  return { kind: "symbol", value: repeated ? character + character : character, end: index };
}

function trackBracket(brackets: string[], character: string): void {
  if ("([{".includes(character)) {
    brackets.push(character);
  } else if (")]}".includes(character)) {
    brackets.pop();
  }
}

type QuotedMaskMode = Extract<
  GroovyMaskMode,
  { type: "single" | "double" | "triple-single" | "triple-double" }
>;

function isQuotedMode(mode: GroovyMaskMode | undefined): mode is QuotedMaskMode {
  return (
    mode?.type === "single" ||
    mode?.type === "double" ||
    mode?.type === "triple-single" ||
    mode?.type === "triple-double"
  );
}

function maskCharacter(character: string | undefined): string {
  return character === "\n" ? "\n" : " ";
}

function maskEscapedCharacter(text: string, chars: string[], index: number): number {
  if (index + 1 < chars.length) {
    chars[index + 1] = maskCharacter(text[index + 1]);
  }
  return index + 2;
}

function enterInterpolation(
  chars: string[],
  index: number,
  modeStack: GroovyMaskMode[],
  recorder: NonCodeRangeRecorder | undefined
): number {
  chars[index] = "$";
  chars[index + 1] = "{";
  // Between `$` and `{` the string is still open.
  recorder?.mark(index + 1, true);
  modeStack.push({ type: "interpolation", depth: 1 });
  return index + 2;
}

function enterStringMode(
  text: string,
  chars: string[],
  index: number,
  modeStack: GroovyMaskMode[],
  previousToken: PreviousToken,
  recorder: NonCodeRangeRecorder | undefined
): number | undefined {
  const character = text[index];
  const next = text[index + 1];
  const nextTwo = text[index + 2];

  if ((character === "'" || character === '"') && next === character && nextTwo === character) {
    modeStack.push({ type: character === "'" ? "triple-single" : "triple-double" });
    chars[index] = " ";
    chars[index + 1] = " ";
    chars[index + 2] = " ";
    // After one quote a string is open; after two, an empty string has just closed.
    recorder?.mark(index + 1, true);
    recorder?.mark(index + 2, false);
    return index + 3;
  }

  if (character === "'") {
    modeStack.push({ type: "single" });
    chars[index] = " ";
    return index + 1;
  }

  if (character === '"') {
    modeStack.push({ type: "double" });
    chars[index] = " ";
    return index + 1;
  }

  if (character === "$" && next === "/") {
    modeStack.push({ type: "dollar-slashy" });
    chars[index] = " ";
    chars[index + 1] = " ";
    // After a lone `$`, a typed character extends an identifier.
    recorder?.mark(index + 1, false);
    return index + 2;
  }

  if (character === "/" && canStartSlashyString(previousToken)) {
    modeStack.push({ type: "slashy" });
    chars[index] = " ";
    return index + 1;
  }

  return undefined;
}

// Keywords after which Groovy's lexer still allows a slashy literal.
const SLASHY_KEYWORDS = new Set([
  "as",
  "assert",
  "case",
  "else",
  "in",
  "instanceof",
  "return",
  "throw",
  "yield"
]);

/**
 * Like Groovy's lexer, read a slash after an identifier, literal, or closing
 * bracket as division; only keywords such as `return` or `in` can precede a
 * slashy literal. (A bare call such as `sh /re/` does not compile in Groovy.)
 */
function canStartSlashyString(previous: PreviousToken): boolean {
  switch (previous.kind) {
    case "start":
    case "newline":
      return true;
    case "literal":
      return false;
    case "word":
      return !previous.member && SLASHY_KEYWORDS.has(previous.value);
    case "symbol":
      return previous.value.length === 1 && "([{=,:?~!;+-*%&|^<>".includes(previous.value);
  }
}
