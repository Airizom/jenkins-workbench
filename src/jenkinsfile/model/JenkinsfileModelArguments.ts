import { WORD_CHAR_PATTERN } from "../context/JenkinsfileContextConstants";
import { findNextMeaningfulIndex, readIdentifier } from "../context/JenkinsfileContextNavigation";
import type { JenkinsfileTextRange } from "./JenkinsfileDocumentModelTypes";

export interface JenkinsfileModelSource {
  text: string;
  maskedText: string;
}

interface JenkinsfileNamedArgument {
  key: string;
  value: JenkinsfileTextRange;
}

export interface JenkinsfileStringLiteral {
  content: string;
  contentRange: JenkinsfileTextRange;
  /** Double-quoted (single or triple) string that contains `${`. */
  interpolated: boolean;
}

const OPENERS = "([{";
const CLOSERS = ")]}";
const LITERAL_DELIMITERS = ['"""', "'''", '"', "'"];

/**
 * Splits `start..end` on top-level commas. Brackets are read from the masked text, so commas
 * inside strings and comments never split. Each range is trimmed against the original text.
 */
export function splitTopLevel(
  source: JenkinsfileModelSource,
  start: number,
  end: number,
  options: { angleBrackets?: boolean } = {}
): JenkinsfileTextRange[] {
  const { maskedText } = source;
  const parts: JenkinsfileTextRange[] = [];
  let depth = 0;
  let angleDepth = 0;
  let partStart = start;
  for (let index = start; index < end; index += 1) {
    const character = maskedText[index];
    if (OPENERS.includes(character)) {
      depth += 1;
    } else if (CLOSERS.includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (options.angleBrackets && character === "<") {
      angleDepth += 1;
    } else if (options.angleBrackets && character === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    } else if (character === "," && depth === 0 && angleDepth === 0) {
      pushTrimmed(source.text, partStart, index, parts);
      partStart = index + 1;
    }
  }
  pushTrimmed(source.text, partStart, end, parts);
  return parts;
}

export function trimRange(text: string, start: number, end: number): JenkinsfileTextRange {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && isWhitespace(text[trimmedStart])) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && isWhitespace(text[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }
  return { start: trimmedStart, end: trimmedEnd };
}

/** Reads `key: value` from an argument range; quoted keys are not recognized. */
function readNamedArgument(
  source: JenkinsfileModelSource,
  range: JenkinsfileTextRange
): JenkinsfileNamedArgument | undefined {
  const { maskedText } = source;
  if (!isIdentifierStart(maskedText[range.start])) {
    return undefined;
  }
  const key = readIdentifier(maskedText, range.start);
  const colon = findNextMeaningfulIndex(maskedText, key.end);
  if (colon === undefined || colon >= range.end || maskedText[colon] !== ":") {
    return undefined;
  }
  return { key: key.name, value: trimRange(source.text, colon + 1, range.end) };
}

export function readNamedArguments(
  source: JenkinsfileModelSource,
  start: number,
  end: number
): Map<string, JenkinsfileTextRange> {
  const named = new Map<string, JenkinsfileTextRange>();
  for (const part of splitTopLevel(source, start, end)) {
    const argument = readNamedArgument(source, part);
    if (argument && !named.has(argument.key)) {
      named.set(argument.key, argument.value);
    }
  }
  return named;
}

/**
 * Returns the content of `range` when it is exactly one quoted string literal. Slashy strings
 * are not recognized.
 */
export function readStringLiteral(
  source: JenkinsfileModelSource,
  range: JenkinsfileTextRange
): JenkinsfileStringLiteral | undefined {
  const { text, maskedText } = source;
  const delimiter = LITERAL_DELIMITERS.find(
    (candidate) =>
      range.end - range.start >= candidate.length * 2 &&
      text.startsWith(candidate, range.start) &&
      text.startsWith(candidate, range.end - candidate.length)
  );
  if (!delimiter) {
    return undefined;
  }
  const doubleQuoted = delimiter[0] === '"';
  // The masker blanks the whole literal except `${...}` code, so anything else visible means
  // the range holds more than one token (for example `'a' + 'b'`).
  let index = range.start;
  while (index < range.end) {
    if (doubleQuoted && maskedText[index] === "$" && maskedText[index + 1] === "{") {
      index = skipInterpolation(maskedText, index, range.end);
      continue;
    }
    if (!isWhitespace(maskedText[index])) {
      return undefined;
    }
    index += 1;
  }
  const contentRange = {
    start: range.start + delimiter.length,
    end: range.end - delimiter.length
  };
  const content = text.slice(contentRange.start, contentRange.end);
  return { content, contentRange, interpolated: doubleQuoted && content.includes("${") };
}

/** Returns the inner range of a `[...]` list argument. */
export function readListInterior(
  source: JenkinsfileModelSource,
  range: JenkinsfileTextRange
): JenkinsfileTextRange | undefined {
  const { maskedText } = source;
  if (
    range.end - range.start < 2 ||
    maskedText[range.start] !== "[" ||
    maskedText[range.end - 1] !== "]"
  ) {
    return undefined;
  }
  return { start: range.start + 1, end: range.end - 1 };
}

/**
 * Returns the index just after the `}` that closes the `${` at `index`, or `index + 2` when it
 * is unclosed before `limit`.
 */
export function skipInterpolation(maskedText: string, index: number, limit: number): number {
  let depth = 0;
  for (let current = index + 1; current < limit; current += 1) {
    const character = maskedText[current];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return current + 1;
      }
    }
  }
  return index + 2;
}

export function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/.test(character);
}

export function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHAR_PATTERN.test(character);
}

export function isWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f" ||
    character === "\v"
  );
}

function pushTrimmed(
  text: string,
  start: number,
  end: number,
  parts: JenkinsfileTextRange[]
): void {
  const range = trimRange(text, start, end);
  if (range.end > range.start) {
    parts.push(range);
  }
}
