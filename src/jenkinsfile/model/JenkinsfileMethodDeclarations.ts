import { findNextMeaningfulIndex, readIdentifier } from "../context/JenkinsfileContextNavigation";
import type {
  JenkinsfileMethodParameter,
  JenkinsfileTextRange
} from "./JenkinsfileDocumentModelTypes";
import {
  isIdentifierStart,
  isWhitespace,
  isWordCharacter,
  type JenkinsfileModelSource,
  splitTopLevel,
  trimRange
} from "./JenkinsfileModelArguments";

export interface JenkinsfileMethodCandidate {
  name: string;
  nameRange: JenkinsfileTextRange;
  start: number;
  openBrace: number;
  openParen: number;
  closeParen: number;
}

const MODIFIERS = new Set(["private", "public", "protected", "static", "final", "abstract"]);

const NON_METHOD_WORDS = new Set([
  "as",
  "assert",
  "case",
  "catch",
  "class",
  "do",
  "else",
  "enum",
  "finally",
  "for",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "new",
  "package",
  "return",
  "switch",
  "synchronized",
  "throw",
  "trait",
  "try",
  "while",
  "yield"
]);

/**
 * Matches `[modifiers] (def | void | Type) name(params) {` starting at the word at `start`,
 * where `Type` may be dotted, generic, or an array. Modifiers alone may also stand in for
 * the return type (`private helper() {`).
 */
export function readMethodCandidate(
  maskedText: string,
  start: number
): JenkinsfileMethodCandidate | undefined {
  const signature = readMethodSignature(maskedText, start);
  if (!signature) {
    return undefined;
  }
  const { nameWord, openParen } = signature;
  const closeParen = findClosingParen(maskedText, openParen);
  if (closeParen === undefined) {
    return undefined;
  }
  const openBrace = findNextMeaningfulIndex(maskedText, closeParen + 1);
  if (openBrace === undefined || maskedText[openBrace] !== "{") {
    return undefined;
  }
  return {
    name: nameWord.name,
    nameRange: { start: nameWord.start, end: nameWord.end },
    start,
    openBrace,
    openParen,
    closeParen
  };
}

function readMethodSignature(
  maskedText: string,
  start: number
): { nameWord: { name: string; start: number; end: number }; openParen: number } | undefined {
  let word = readWord(maskedText, start);
  if (!word) {
    return undefined;
  }
  let sawModifier = false;
  while (MODIFIERS.has(word.name)) {
    sawModifier = true;
    const next = readWord(maskedText, skipWhitespace(maskedText, word.end));
    if (!next) {
      return undefined;
    }
    word = next;
  }
  if (NON_METHOD_WORDS.has(word.name)) {
    return undefined;
  }

  let index = skipWhitespace(maskedText, word.end);
  let nameWord: { name: string; start: number; end: number } | undefined;
  if (maskedText[index] === "(" && sawModifier && word.name !== "def" && word.name !== "void") {
    nameWord = word;
  } else {
    index = skipTypeSuffix(maskedText, index);
    if (index < 0) {
      return undefined;
    }
    nameWord = readWord(maskedText, index);
    if (!nameWord || NON_METHOD_WORDS.has(nameWord.name) || MODIFIERS.has(nameWord.name)) {
      return undefined;
    }
    index = skipWhitespace(maskedText, nameWord.end);
  }

  if (maskedText[index] !== "(") {
    return undefined;
  }
  return { nameWord, openParen: index };
}

export function readMethodParameters(
  source: JenkinsfileModelSource,
  start: number,
  end: number
): JenkinsfileMethodParameter[] {
  const parameters: JenkinsfileMethodParameter[] = [];
  for (const part of splitTopLevel(source, start, end, { angleBrackets: true })) {
    const parameter = readParameter(source, part);
    if (parameter) {
      parameters.push(parameter);
    }
  }
  return parameters;
}

function readParameter(
  source: JenkinsfileModelSource,
  range: JenkinsfileTextRange
): JenkinsfileMethodParameter | undefined {
  const { text, maskedText } = source;
  const assignment = findTopLevelAssignment(maskedText, range);
  const declaration = trimRange(text, range.start, assignment ?? range.end);
  let nameEnd = declaration.end;
  while (nameEnd > declaration.start && !isWordCharacter(maskedText[nameEnd - 1])) {
    nameEnd -= 1;
  }
  if (nameEnd <= declaration.start) {
    return undefined;
  }
  const name = readIdentifier(maskedText, nameEnd - 1);
  const typeText = text
    .slice(declaration.start, name.start)
    .trim()
    .replace(/^(?:final\s+)+/, "")
    .trim();
  return {
    name: name.name,
    type: typeText && typeText !== "def" ? typeText : undefined,
    hasDefault: assignment !== undefined
  };
}

function findTopLevelAssignment(
  maskedText: string,
  range: JenkinsfileTextRange
): number | undefined {
  let depth = 0;
  for (let index = range.start; index < range.end; index += 1) {
    const character = maskedText[index];
    if ("([{<".includes(character)) {
      depth += 1;
    } else if (")]}>".includes(character)) {
      depth = Math.max(0, depth - 1);
    } else if (
      character === "=" &&
      depth === 0 &&
      maskedText[index + 1] !== "=" &&
      !"=!<>".includes(maskedText[index - 1] ?? "")
    ) {
      return index;
    }
  }
  return undefined;
}

/** Skips `.Qualified.Name`, `<Generics>` and `[]` after a type word; returns -1 on malformed input. */
function skipTypeSuffix(maskedText: string, start: number): number {
  let index = start;
  while (maskedText[index] === ".") {
    const word = readWord(maskedText, skipWhitespace(maskedText, index + 1));
    if (!word) {
      return -1;
    }
    index = skipWhitespace(maskedText, word.end);
  }
  if (maskedText[index] === "<") {
    index = skipGenericArguments(maskedText, index);
    if (index < 0) {
      return -1;
    }
  }
  while (maskedText[index] === "[") {
    const close = skipWhitespace(maskedText, index + 1);
    if (maskedText[close] !== "]") {
      return -1;
    }
    index = skipWhitespace(maskedText, close + 1);
  }
  return index;
}

function skipGenericArguments(maskedText: string, start: number): number {
  let depth = 0;
  for (let index = start; index < maskedText.length; index += 1) {
    const character = maskedText[index];
    if (character === "<") {
      depth += 1;
    } else if (character === ">") {
      depth -= 1;
      if (depth === 0) {
        return skipWhitespace(maskedText, index + 1);
      }
    } else if (
      !isWordCharacter(character) &&
      !isWhitespace(character) &&
      !",.?[]&".includes(character)
    ) {
      return -1;
    }
  }
  return -1;
}

function findClosingParen(maskedText: string, openParen: number): number | undefined {
  let depth = 0;
  for (let index = openParen; index < maskedText.length; index += 1) {
    const character = maskedText[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function readWord(
  maskedText: string,
  index: number
): { name: string; start: number; end: number } | undefined {
  if (!isIdentifierStart(maskedText[index]) || isWordCharacter(maskedText[index - 1])) {
    return undefined;
  }
  return readIdentifier(maskedText, index);
}

function skipWhitespace(maskedText: string, index: number): number {
  let current = index;
  while (current < maskedText.length && isWhitespace(maskedText[current])) {
    current += 1;
  }
  return current;
}
