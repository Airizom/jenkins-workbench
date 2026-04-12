import { WORD_CHAR_PATTERN } from "./JenkinsfileContextConstants";
import type { JenkinsfileClosedCall, JenkinsfileIdentifier } from "./JenkinsfileContextTypes";

const ALLOWED_IDENTIFIER_PREFIXES = new Set(["else", "return", "throw", "yield"]);

export function findIdentifierAt(
  maskedText: string,
  offset: number
): JenkinsfileIdentifier | undefined {
  const index = resolveIdentifierIndex(maskedText, offset);
  if (index === undefined) {
    return undefined;
  }
  return readIdentifier(maskedText, index);
}

export function findPartialIdentifier(
  maskedText: string,
  offset: number
): JenkinsfileIdentifier | undefined {
  if (offset > 0 && WORD_CHAR_PATTERN.test(maskedText[offset - 1])) {
    const start = findIdentifierStart(maskedText, offset - 1);
    const end = offset;
    return {
      name: maskedText.slice(start, end),
      start,
      end
    };
  }
  return undefined;
}

export function readIdentifier(maskedText: string, index: number): JenkinsfileIdentifier {
  const start = findIdentifierStart(maskedText, index);
  let end = index + 1;
  while (end < maskedText.length && WORD_CHAR_PATTERN.test(maskedText[end])) {
    end += 1;
  }
  return {
    name: maskedText.slice(start, end),
    start,
    end
  };
}

export function isWordStart(maskedText: string, index: number): boolean {
  return (
    WORD_CHAR_PATTERN.test(maskedText[index]) &&
    (index === 0 || !WORD_CHAR_PATTERN.test(maskedText[index - 1]))
  );
}

export function resolveCallName(maskedText: string, openParen: number): string | undefined {
  const previous = findPreviousMeaningfulIndex(maskedText, openParen - 1);
  if (previous === undefined || !WORD_CHAR_PATTERN.test(maskedText[previous])) {
    return undefined;
  }
  const identifier = readIdentifier(maskedText, previous);
  return identifier.end === previous + 1 ? identifier.name : undefined;
}

export function resolveBraceLabel(
  maskedText: string,
  openBrace: number,
  lastClosedCall: JenkinsfileClosedCall | undefined
): string | undefined {
  const previous = findPreviousMeaningfulIndex(maskedText, openBrace - 1);
  if (previous === undefined) {
    return undefined;
  }
  const previousChar = maskedText[previous];
  if (WORD_CHAR_PATTERN.test(previousChar)) {
    return readIdentifier(maskedText, previous).name;
  }
  if (previousChar === ")" && lastClosedCall && lastClosedCall.closeParen === previous) {
    return lastClosedCall.name;
  }
  return undefined;
}

export function findPreviousMeaningfulIndex(text: string, index: number): number | undefined {
  let current = index;
  while (current >= 0) {
    if (!text[current].trim()) {
      current -= 1;
      continue;
    }
    return current;
  }
  return undefined;
}

export function findNextMeaningfulIndex(text: string, index: number): number | undefined {
  let current = index;
  while (current < text.length) {
    if (text[current].trim()) {
      return current;
    }
    current += 1;
  }
  return undefined;
}

export function findStatementStart(text: string, offset: number): number {
  let current = Math.max(0, offset - 1);
  while (current >= 0) {
    const character = text[current];
    if (character === "\n" || character === ";" || character === "{" || character === "}") {
      return current + 1;
    }
    current -= 1;
  }
  return 0;
}

export function findBareCallArgumentStart(text: string, callStart: number): number {
  let current = callStart;
  while (current < text.length && WORD_CHAR_PATTERN.test(text[current])) {
    current += 1;
  }
  return current;
}

export function isValidStepStart(maskedText: string, offset: number): boolean {
  const partial = findPartialIdentifier(maskedText, offset);
  const anchor = partial?.start ?? offset;
  const statementStart = findStatementStart(maskedText, anchor);
  if (anchor > 0 && WORD_CHAR_PATTERN.test(maskedText[anchor - 1])) {
    return false;
  }
  const previous = findPreviousMeaningfulIndex(maskedText, anchor - 1);
  if (previous === undefined || previous < statementStart) {
    return true;
  }
  const character = maskedText[previous];
  if (
    character === "." ||
    character === ":" ||
    character === "," ||
    character === "(" ||
    character === "["
  ) {
    return false;
  }
  if (WORD_CHAR_PATTERN.test(character)) {
    const previousIdentifier = readIdentifier(maskedText, previous);
    return ALLOWED_IDENTIFIER_PREFIXES.has(previousIdentifier.name);
  }
  return true;
}

function resolveIdentifierIndex(maskedText: string, offset: number): number | undefined {
  if (offset < maskedText.length && WORD_CHAR_PATTERN.test(maskedText[offset])) {
    return offset;
  }
  if (offset > 0 && WORD_CHAR_PATTERN.test(maskedText[offset - 1])) {
    return offset - 1;
  }
  return undefined;
}

function findIdentifierStart(maskedText: string, index: number): number {
  let start = index;
  while (start > 0 && WORD_CHAR_PATTERN.test(maskedText[start - 1])) {
    start -= 1;
  }
  return start;
}
