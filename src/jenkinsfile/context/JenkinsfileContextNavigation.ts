import { BARE_CALL_PREFIX_KEYWORDS, WORD_CHAR_PATTERN } from "./JenkinsfileContextConstants";
import type {
  JenkinsfileClosedCall,
  JenkinsfileIdentifier,
  JenkinsfileMemberAccess
} from "./JenkinsfileContextTypes";

const IDENTIFIER_START_PATTERN = /[A-Za-z_$]/;

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

/**
 * Resolves `a.b.par|` style member access at the cursor. Every receiver segment must be a
 * plain identifier joined by `.` or `?.` without surrounding whitespace.
 */
export function findMemberAccess(
  maskedText: string,
  offset: number
): JenkinsfileMemberAccess | undefined {
  let partialStart = offset;
  while (partialStart > 0 && WORD_CHAR_PATTERN.test(maskedText[partialStart - 1])) {
    partialStart -= 1;
  }
  const partial = maskedText.slice(partialStart, offset);
  if (partial && !IDENTIFIER_START_PATTERN.test(partial[0])) {
    return undefined;
  }
  const receiver = readReceiverChain(maskedText, partialStart);
  return receiver ? { receiver, partial, start: partialStart, end: offset } : undefined;
}

/** The identifier at a cursor and, when it follows a `.`, the receiver it is read from. */
export interface JenkinsfileMemberAccessAt {
  member: JenkinsfileIdentifier;
  /**
   * Identifier chain before the member, left to right. Undefined when the receiver is not a
   * plain chain: a call or index result, a spread (`*.`) or range (`..`) operator, or
   * whitespace around a `.`.
   */
  receiver?: string[];
}

/**
 * Resolves the member identifier at `offset` together with its receiver chain, for
 * example `previousBuild` in `currentBuild.previousBuild.result` gives receiver
 * `["currentBuild"]`. Undefined when the identifier does not follow a `.`.
 */
export function findMemberAccessAt(
  maskedText: string,
  offset: number
): JenkinsfileMemberAccessAt | undefined {
  const member = findIdentifierAt(maskedText, offset);
  if (!member || !IDENTIFIER_START_PATTERN.test(member.name[0])) {
    return undefined;
  }
  const receiver = readReceiverChain(maskedText, member.start);
  if (receiver === undefined) {
    return undefined;
  }
  return receiver ? { member, receiver } : { member };
}

/**
 * Reads the receiver chain before the `.` or `?.` that ends at `memberStart`. Returns
 * undefined when no `.` precedes the member (whitespace allowed), and null when one does but
 * the receiver is not a whitespace-free chain of plain identifiers.
 */
function readReceiverChain(maskedText: string, memberStart: number): string[] | null | undefined {
  const receiver: string[] = [];
  let dot = memberStart - 1;
  while (maskedText[dot] === ".") {
    const segmentEnd = maskedText[dot - 1] === "?" ? dot - 1 : dot;
    if (segmentEnd <= 0 || !WORD_CHAR_PATTERN.test(maskedText[segmentEnd - 1])) {
      return null;
    }
    const segmentStart = findIdentifierStart(maskedText, segmentEnd - 1);
    const segment = maskedText.slice(segmentStart, segmentEnd);
    if (!IDENTIFIER_START_PATTERN.test(segment[0])) {
      return null;
    }
    receiver.unshift(segment);
    dot = segmentStart - 1;
  }

  // A `.` across whitespace still makes this a member access, just not a plain chain.
  const previous = findPreviousMeaningfulIndex(maskedText, dot);
  if (previous !== undefined && maskedText[previous] === ".") {
    return null;
  }
  return receiver.length > 0 ? receiver : undefined;
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
  return readIdentifier(maskedText, previous).name;
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

function findStatementStart(text: string, offset: number): number {
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
    return BARE_CALL_PREFIX_KEYWORDS.has(previousIdentifier.name);
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
