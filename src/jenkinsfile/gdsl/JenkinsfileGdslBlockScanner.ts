import {
  findCallStart,
  findMatchingDelimiter,
  findMatchingDelimiterBackward,
  findPreviousMeaningfulIndex,
  readIdentifierBackward,
  skipBlockComment,
  skipLineComment,
  skipString,
  skipWhitespace
} from "./JenkinsfileGdslScannerUtils";
import type { ContributorBlock, ScannedMethodCall } from "./JenkinsfileGdslTypes";
import { parseCallExpression } from "./JenkinsfileGdslValueParser";

const NON_STEP_GUARD_NAMES = new Set([
  "agent",
  "environment",
  "input",
  "options",
  "parameters",
  "post",
  "stage",
  "stages",
  "tools",
  "triggers",
  "when"
]);
const NODE_CONTEXT_GUARD_NAMES = new Set(["node"]);
const IDENTIFIER_PATTERN = /[A-Za-z_$][\w$]*/y;

export function scanContributorBlocks(text: string): ContributorBlock[] {
  const blocks: ContributorBlock[] = [];
  let index = 0;
  while (index < text.length) {
    const match = findCallStart(text, "contributor", index);
    if (match === undefined) {
      break;
    }
    const openParen = skipWhitespace(text, match + "contributor".length);
    if (text[openParen] !== "(") {
      index = match + "contributor".length;
      continue;
    }
    const closeParen = findMatchingDelimiter(text, openParen, "(", ")");
    const openBrace = skipWhitespace(text, closeParen + 1);
    if (text[openBrace] !== "{") {
      index = closeParen + 1;
      continue;
    }
    const closeBrace = findMatchingDelimiter(text, openBrace, "{", "}");
    blocks.push({
      body: text.slice(openBrace + 1, closeBrace)
    });
    index = closeBrace + 1;
  }
  return blocks;
}

export function scanMethodCalls(body: string): ScannedMethodCall[] {
  const calls: ScannedMethodCall[] = [];
  const guardStack: string[][] = [];
  const aliasScopes: Array<Map<string, string[]>> = [new Map()];
  let index = 0;

  while (index < body.length) {
    const character = body[index];
    if (character === "'" || character === '"') {
      index = skipString(body, index);
      continue;
    }
    if (character === "/" && body[index + 1] === "/") {
      index = skipLineComment(body, index);
      continue;
    }
    if (character === "/" && body[index + 1] === "*") {
      index = skipBlockComment(body, index);
      continue;
    }
    const aliasAssignment = findGuardAliasAssignment(body, index);
    if (aliasAssignment) {
      aliasScopes[aliasScopes.length - 1].set(aliasAssignment.name, aliasAssignment.guardNames);
      index = aliasAssignment.end;
      continue;
    }
    if (character === "{") {
      guardStack.push(resolveGuardNames(body, index, aliasScopes));
      aliasScopes.push(new Map());
      index += 1;
      continue;
    }
    if (character === "}") {
      guardStack.pop();
      aliasScopes.pop();
      index += 1;
      continue;
    }

    const match = findCallStart(body, "method", index);
    if (match !== index) {
      index += 1;
      continue;
    }

    const openParen = skipWhitespace(body, match + "method".length);
    if (body[openParen] !== "(") {
      index = match + "method".length;
      continue;
    }

    const closeParen = findMatchingDelimiter(body, openParen, "(", ")");
    const activeGuardNames = guardStack.flat();
    if (!shouldSuppressMethod(activeGuardNames)) {
      calls.push({
        call: parseCallExpression(body.slice(match, closeParen + 1)),
        requiresNodeContext: activeGuardNames.some((name) => NODE_CONTEXT_GUARD_NAMES.has(name))
      });
    }
    index = closeParen + 1;
  }
  return calls;
}

function resolveGuardNames(
  text: string,
  openBrace: number,
  aliasScopes: ReadonlyArray<ReadonlyMap<string, string[]>>
): string[] {
  const previous = findPreviousMeaningfulIndex(text, openBrace - 1);
  if (previous === undefined || text[previous] !== ")") {
    return [];
  }

  const openParen = findMatchingDelimiterBackward(text, previous, "(", ")");
  const keywordEnd = findPreviousMeaningfulIndex(text, openParen - 1);
  if (keywordEnd === undefined) {
    return [];
  }

  const keyword = readIdentifierBackward(text, keywordEnd);
  if (keyword !== "if") {
    return [];
  }

  const condition = text.slice(openParen + 1, previous);
  const directGuardNames = extractGuardNames(condition);
  if (directGuardNames.length > 0) {
    return directGuardNames;
  }

  const aliasGuardNames = new Set<string>();
  for (const alias of extractConditionIdentifiers(condition)) {
    const resolved = resolveGuardAlias(alias, aliasScopes);
    for (const guardName of resolved) {
      aliasGuardNames.add(guardName);
    }
  }
  return [...aliasGuardNames];
}

function shouldSuppressMethod(guardNames: readonly string[]): boolean {
  return guardNames.length > 0 && guardNames.every((name) => NON_STEP_GUARD_NAMES.has(name));
}

function findGuardAliasAssignment(
  text: string,
  index: number
): { name: string; guardNames: string[]; end: number } | undefined {
  IDENTIFIER_PATTERN.lastIndex = index;
  let match = IDENTIFIER_PATTERN.exec(text);
  let hasDefKeyword = false;

  if (match?.[0] === "def") {
    hasDefKeyword = true;
    const nextIdentifierIndex = skipWhitespace(text, IDENTIFIER_PATTERN.lastIndex);
    IDENTIFIER_PATTERN.lastIndex = nextIdentifierIndex;
    match = IDENTIFIER_PATTERN.exec(text);
  }

  if (!match) {
    return undefined;
  }

  const assignmentName = match[0];
  const assignmentStart = hasDefKeyword ? index : match.index;
  if (assignmentStart !== index) {
    return undefined;
  }

  const equalsIndex = skipWhitespace(text, IDENTIFIER_PATTERN.lastIndex);
  if (text[equalsIndex] !== "=") {
    return undefined;
  }

  const valueStart = skipWhitespace(text, equalsIndex + 1);
  const lineEnd = findAssignmentEnd(text, valueStart);
  const valueText = text.slice(valueStart, lineEnd);
  const guardNames = extractGuardNames(valueText);
  if (guardNames.length === 0) {
    return undefined;
  }

  return {
    name: assignmentName,
    guardNames,
    end: lineEnd
  };
}

function findAssignmentEnd(text: string, index: number): number {
  let current = index;
  while (current < text.length) {
    const character = text[current];
    if (character === "\n" || character === ";" || character === "{") {
      break;
    }
    current += 1;
  }
  return current;
}

function extractGuardNames(text: string): string[] {
  return [...text.matchAll(/enclosingCall(?:Name)?\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1]
  );
}

function extractConditionIdentifiers(text: string): string[] {
  return [...text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((match) => match[0]);
}

function resolveGuardAlias(
  alias: string,
  aliasScopes: ReadonlyArray<ReadonlyMap<string, string[]>>
): readonly string[] {
  for (let index = aliasScopes.length - 1; index >= 0; index -= 1) {
    const resolved = aliasScopes[index].get(alias);
    if (resolved) {
      return resolved;
    }
  }
  return [];
}
