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

export function maskGroovyText(text: string): string {
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
        inLineComment = true;
        index += 2;
        continue;
      }

      if (character === "/" && next === "*") {
        chars[index] = " ";
        chars[index + 1] = " ";
        inBlockComment = true;
        index += 2;
        continue;
      }

      const nextIndex = enterStringMode(text, chars, index, modeStack, previousToken);
      if (nextIndex !== undefined) {
        index = nextIndex;
        continue;
      }
    }

    if (isQuotedMode(currentMode)) {
      const quote =
        currentMode.type === "single" || currentMode.type === "triple-single" ? "'" : '"';
      chars[index] = maskCharacter(character);
      if (character === "\\") {
        index = maskEscapedCharacter(text, chars, index);
        continue;
      }
      if (quote === '"' && character === "$" && next === "{") {
        index = enterInterpolation(chars, index, modeStack);
        brackets.push("{");
        previousToken = { kind: "symbol", value: "{", end: index - 1 };
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
        index = maskEscapedCharacter(text, chars, index);
        continue;
      }
      if (
        currentMode.type === "dollar-slashy" &&
        character === "$" &&
        (next === "$" || next === "/")
      ) {
        chars[index + 1] = " ";
        index += 2;
        continue;
      }
      if (character === "$" && next === "{") {
        index = enterInterpolation(chars, index, modeStack);
        brackets.push("{");
        previousToken = { kind: "symbol", value: "{", end: index - 1 };
        continue;
      }
      if (currentMode.type === "slashy" && character === "/") {
        modeStack.pop();
        previousToken = LITERAL_TOKEN;
      } else if (currentMode.type === "dollar-slashy" && character === "/" && next === "$") {
        chars[index + 1] = " ";
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

  return chars.join("");
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

function enterInterpolation(chars: string[], index: number, modeStack: GroovyMaskMode[]): number {
  chars[index] = "$";
  chars[index + 1] = "{";
  modeStack.push({ type: "interpolation", depth: 1 });
  return index + 2;
}

function enterStringMode(
  text: string,
  chars: string[],
  index: number,
  modeStack: GroovyMaskMode[],
  previousToken: PreviousToken
): number | undefined {
  const character = text[index];
  const next = text[index + 1];
  const nextTwo = text[index + 2];

  if (character === "'" && next === "'" && nextTwo === "'") {
    modeStack.push({ type: "triple-single" });
    chars[index] = " ";
    chars[index + 1] = " ";
    chars[index + 2] = " ";
    return index + 3;
  }

  if (character === '"' && next === '"' && nextTwo === '"') {
    modeStack.push({ type: "triple-double" });
    chars[index] = " ";
    chars[index + 1] = " ";
    chars[index + 2] = " ";
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
