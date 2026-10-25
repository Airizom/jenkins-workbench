import {
  buildGdslCommentMask,
  findCallStart,
  findMatchingDelimiter,
  findPreviousMeaningfulIndex,
  isCallStartAt,
  readIdentifierBackward,
  skipString,
  skipStringOrComment,
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
  const commentMask = buildGdslCommentMask(body);
  // Open-paren index for each close paren seen so far, so guards resolve without rescanning.
  const openParenByClose = new Map<number, number>();
  const openParens: number[] = [];
  let index = 0;

  while (index < body.length) {
    const nextIndex = skipStringOrComment(body, index);
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }
    const character = body[index];
    const aliasAssignment = findGuardAliasAssignment(body, index, aliasScopes);
    if (aliasAssignment) {
      // A declaration binds in the current scope; a reassignment updates the
      // nearest scope that already declares the alias.
      let scopeIndex = aliasScopes.length - 1;
      if (!aliasAssignment.declared) {
        for (let candidate = scopeIndex; candidate >= 0; candidate -= 1) {
          if (aliasScopes[candidate].has(aliasAssignment.name)) {
            scopeIndex = candidate;
            break;
          }
        }
      }
      aliasScopes[scopeIndex].set(aliasAssignment.name, aliasAssignment.guardNames);
      trackParens(body, index, aliasAssignment.end, openParens, openParenByClose);
      index = aliasAssignment.end;
      continue;
    }
    if (character === "(" || character === ")") {
      trackParens(body, index, index + 1, openParens, openParenByClose);
    }
    if (character === "{") {
      guardStack.push(resolveGuardNames(body, index, aliasScopes, commentMask, openParenByClose));
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

    if (!isCallStartAt(body, "method", index)) {
      index += 1;
      continue;
    }

    const openParen = skipWhitespace(body, index + "method".length);
    if (body[openParen] !== "(") {
      index += "method".length;
      continue;
    }

    const closeParen = findMatchingDelimiter(body, openParen, "(", ")");
    const activeGuardNames = guardStack.flat();
    if (!shouldSuppressMethod(activeGuardNames)) {
      calls.push({
        call: parseCallExpression(body.slice(index, closeParen + 1)),
        requiresNodeContext: activeGuardNames.includes("node")
      });
    }
    index = closeParen + 1;
  }
  return calls;
}

function trackParens(
  text: string,
  start: number,
  end: number,
  openParens: number[],
  openParenByClose: Map<number, number>
): void {
  let index = start;
  while (index < end) {
    const nextIndex = skipStringOrComment(text, index);
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }
    if (text[index] === "(") {
      openParens.push(index);
    } else if (text[index] === ")") {
      const openParen = openParens.pop();
      if (openParen !== undefined) {
        openParenByClose.set(index, openParen);
      }
    }
    index += 1;
  }
}

function resolveGuardNames(
  text: string,
  openBrace: number,
  aliasScopes: ReadonlyArray<ReadonlyMap<string, string[]>>,
  commentMask: Uint8Array,
  openParenByClose: ReadonlyMap<number, number>
): string[] {
  const previous = findPreviousMeaningfulIndex(text, openBrace - 1, commentMask);
  if (previous === undefined || text[previous] !== ")") {
    return [];
  }

  // Parens skipped as part of a method(...) call are never `if` conditions.
  const openParen = openParenByClose.get(previous);
  if (openParen === undefined) {
    return [];
  }
  const keywordEnd = findPreviousMeaningfulIndex(text, openParen - 1, commentMask);
  if (keywordEnd === undefined) {
    return [];
  }

  const keyword = readIdentifierBackward(text, keywordEnd);
  if (keyword !== "if") {
    return [];
  }

  const condition = text.slice(openParen + 1, previous);
  return extractGuardNames(condition, aliasScopes);
}

function shouldSuppressMethod(guardNames: readonly string[]): boolean {
  return guardNames.length > 0 && guardNames.every((name) => NON_STEP_GUARD_NAMES.has(name));
}

function findGuardAliasAssignment(
  text: string,
  index: number,
  aliasScopes: ReadonlyArray<ReadonlyMap<string, string[]>>
): { name: string; guardNames: string[]; end: number; declared: boolean } | undefined {
  IDENTIFIER_PATTERN.lastIndex = index;
  let match = IDENTIFIER_PATTERN.exec(text);
  const declared = match?.[0] === "def";

  if (declared) {
    const nextIdentifierIndex = skipWhitespace(text, IDENTIFIER_PATTERN.lastIndex);
    IDENTIFIER_PATTERN.lastIndex = nextIdentifierIndex;
    match = IDENTIFIER_PATTERN.exec(text);
  }

  if (!match) {
    return undefined;
  }

  const assignmentName = match[0];
  const nameEnd = IDENTIFIER_PATTERN.lastIndex;
  const equalsIndex = skipWhitespace(text, nameEnd);
  if (text[equalsIndex] !== "=" || /[=~]/.test(text[equalsIndex + 1] ?? "")) {
    // An uninitialized local declaration still shadows outer aliases; `def name(` is a method.
    return declared && text[equalsIndex] !== "("
      ? { name: assignmentName, guardNames: [], declared, end: nameEnd }
      : undefined;
  }

  const valueStart = skipWhitespace(text, equalsIndex + 1);
  const lineEnd = findAssignmentEnd(text, valueStart);
  const valueText = text.slice(valueStart, lineEnd);
  const guardNames = extractGuardNames(valueText, aliasScopes);

  return {
    name: assignmentName,
    guardNames,
    declared,
    // Keep scanning other values: they may still contain method declarations.
    end: guardNames.length > 0 ? lineEnd : valueStart
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

function extractGuardNames(
  text: string,
  aliasScopes: ReadonlyArray<ReadonlyMap<string, string[]>>
): string[] {
  const condition = text.trim();
  const alternatives = splitTopLevel(condition, "||");
  if (alternatives.length > 1) {
    const [first, ...rest] = alternatives.map((part) => extractGuardNames(part, aliasScopes));
    return first.filter((name) => rest.every((names) => names.includes(name)));
  }

  const conjuncts = splitTopLevel(condition, "&&");
  if (conjuncts.length > 1) {
    return [...new Set(conjuncts.flatMap((part) => extractGuardNames(part, aliasScopes)))];
  }

  if (condition.startsWith("!")) {
    return [];
  }
  if (
    condition.startsWith("(") &&
    findMatchingDelimiter(condition, 0, "(", ")") === condition.length - 1
  ) {
    return extractGuardNames(condition.slice(1, -1), aliasScopes);
  }

  const direct = /^enclosingCall(?:Name)?\(\s*['"]([^'"]+)['"]\s*\)$/.exec(condition);
  if (direct) {
    return [direct[1]];
  }
  return /^[A-Za-z_$][\w$]*$/.test(condition) ? [...resolveGuardAlias(condition, aliasScopes)] : [];
}

function splitTopLevel(text: string, operator: "&&" | "||"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "'" || text[index] === '"') {
      index = skipString(text, index) - 1;
    } else if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
    } else if (depth === 0 && text.startsWith(operator, index)) {
      parts.push(text.slice(start, index));
      start = index + operator.length;
      index += operator.length - 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
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
