import {
  findBareCallArgumentStart,
  findNextMeaningfulIndex,
  isValidStepStart,
  readIdentifier
} from "./JenkinsfileContextNavigation";
import type { JenkinsfileActiveCall, JenkinsfileArgumentContext } from "./JenkinsfileContextTypes";

const BARE_CALL_PREFIX_KEYWORDS = new Set(["else", "return", "throw", "yield"]);
const BARE_CALL_PREFIX_PAREN_KEYWORDS = new Set(["catch", "for", "if", "switch", "while"]);
const BARE_CALL_PREFIX_DECLARATION_KEYWORDS = new Set(["def", "final"]);
const LEADING_NAMED_ARG_PATTERN = /^\s*([A-Za-z_$][\w$]*)\s*:/;

function extractLeadingNamedArgName(segmentText: string): string | undefined {
  const match = segmentText.match(LEADING_NAMED_ARG_PATTERN);
  if (!match) {
    return undefined;
  }
  const colonIndex = match.index! + match[0].length - 1;
  if (segmentText[colonIndex - 1] === "?") {
    return undefined;
  }
  if (containsTopLevelQuestionMark(segmentText.slice(0, colonIndex))) {
    return undefined;
  }
  return match[1];
}

function containsTopLevelQuestionMark(text: string): boolean {
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") {
      depthParen += 1;
      continue;
    }
    if (character === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (character === "[") {
      depthBracket += 1;
      continue;
    }
    if (character === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }
    if (character === "{") {
      depthBrace += 1;
      continue;
    }
    if (character === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (character === "?" && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      return true;
    }
  }

  return false;
}

export function analyzeActiveCallArguments(
  maskedText: string,
  activeCall: JenkinsfileActiveCall,
  offset: number
): JenkinsfileArgumentContext {
  const segment =
    activeCall.syntax === "paren"
      ? maskedText.slice((activeCall.openParen ?? activeCall.callStart) + 1, offset)
      : maskedText.slice(findBareCallArgumentStart(maskedText, activeCall.callStart), offset);
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let commaCount = 0;
  let currentSegmentStart = 0;
  const namedArgs: string[] = [];

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "(") {
      depthParen += 1;
      continue;
    }
    if (character === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (character === "[") {
      depthBracket += 1;
      continue;
    }
    if (character === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }
    if (character === "{") {
      depthBrace += 1;
      continue;
    }
    if (character === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (character === "," && depthParen === 0 && depthBracket === 0 && depthBrace === 0) {
      const segmentText = segment.slice(currentSegmentStart, index);
      const namedArg = extractLeadingNamedArgName(segmentText);
      if (namedArg) {
        namedArgs.push(namedArg);
      }
      commaCount += 1;
      currentSegmentStart = index + 1;
    }
  }

  const currentSegment = segment.slice(currentSegmentStart);
  const activeName = extractLeadingNamedArgName(currentSegment);

  return {
    activeIndex: commaCount,
    activeName,
    usesNamedArgs: namedArgs.length > 0 || Boolean(activeName)
  };
}

export function findBareActiveCall(
  maskedText: string,
  offset: number
): JenkinsfileActiveCall | undefined {
  const statementStart = findBareCallStatementStart(maskedText, offset);
  const callStart = resolveBareCallStart(maskedText, statementStart, offset);
  if (callStart === undefined) {
    return undefined;
  }
  const name = readIdentifier(maskedText, callStart).name;

  const afterNameIndex = callStart + name.length;
  const nextMeaningful = findNextMeaningfulIndex(maskedText, afterNameIndex);
  if (
    nextMeaningful !== undefined &&
    nextMeaningful < offset &&
    maskedText[nextMeaningful] === "("
  ) {
    return undefined;
  }

  if (offset <= afterNameIndex) {
    return undefined;
  }

  return {
    name,
    syntax: "bare",
    callStart
  };
}

function resolveBareCallStart(
  maskedText: string,
  statementStart: number,
  offset: number
): number | undefined {
  let current = findNextMeaningfulIndex(maskedText, statementStart);
  while (current !== undefined && current < offset) {
    const assignmentStart = resolveAssignmentValueStart(maskedText, current, offset);
    if (assignmentStart !== undefined && assignmentStart !== current) {
      current = assignmentStart;
      continue;
    }

    const identifier = readIdentifier(maskedText, current);
    const nextMeaningful = findNextMeaningfulIndex(maskedText, identifier.end);

    if (
      BARE_CALL_PREFIX_PAREN_KEYWORDS.has(identifier.name) &&
      nextMeaningful !== undefined &&
      maskedText[nextMeaningful] === "("
    ) {
      current = findNextMeaningfulIndex(
        maskedText,
        skipBalancedParentheses(maskedText, nextMeaningful)
      );
      continue;
    }

    if (BARE_CALL_PREFIX_KEYWORDS.has(identifier.name)) {
      current = nextMeaningful;
      continue;
    }

    if (isValidStepStart(maskedText, current)) {
      return current;
    }

    current = nextMeaningful;
  }
  return undefined;
}

function findBareCallStatementStart(maskedText: string, offset: number): number {
  let current = Math.max(0, offset - 1);
  while (current >= 0) {
    const character = maskedText[current];
    if (character === "}") {
      const interpolationStart = findInterpolationStart(maskedText, current);
      if (interpolationStart !== undefined) {
        current = interpolationStart - 1;
        continue;
      }
      return current + 1;
    }
    if (character === "\n" || character === ";" || character === "{") {
      return current + 1;
    }
    current -= 1;
  }
  return 0;
}

function findInterpolationStart(maskedText: string, closeBrace: number): number | undefined {
  let depth = 0;
  let index = closeBrace;
  while (index >= 0) {
    const character = maskedText[index];
    if (character === "}") {
      depth += 1;
    } else if (character === "{") {
      depth -= 1;
      if (depth === 0) {
        return index > 0 && maskedText[index - 1] === "$" ? index - 1 : undefined;
      }
    }
    index -= 1;
  }
  return undefined;
}

function resolveAssignmentValueStart(
  maskedText: string,
  start: number,
  offset: number
): number | undefined {
  let current = start;
  while (current < offset) {
    const identifier = readIdentifier(maskedText, current);
    const nextMeaningful = findNextMeaningfulIndex(maskedText, identifier.end);
    if (nextMeaningful === undefined || nextMeaningful >= offset) {
      return undefined;
    }

    if (
      maskedText[nextMeaningful] === "=" &&
      maskedText[nextMeaningful + 1] !== "=" &&
      maskedText[nextMeaningful - 1] !== "!"
    ) {
      const valueStart = findNextMeaningfulIndex(maskedText, nextMeaningful + 1);
      return valueStart !== undefined && valueStart < offset ? valueStart : undefined;
    }

    if (BARE_CALL_PREFIX_DECLARATION_KEYWORDS.has(identifier.name)) {
      current = nextMeaningful;
      continue;
    }

    if (/[A-Za-z_$]/.test(maskedText[nextMeaningful])) {
      current = nextMeaningful;
      continue;
    }

    return undefined;
  }

  return undefined;
}

function skipBalancedParentheses(maskedText: string, openParen: number): number {
  let depth = 0;
  let index = openParen;
  while (index < maskedText.length) {
    const character = maskedText[index];
    if (character === "$" && maskedText[index + 1] === "{") {
      index = skipInterpolation(maskedText, index + 2);
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return maskedText.length;
}

function skipInterpolation(maskedText: string, start: number): number {
  let depth = 1;
  let index = start;
  while (index < maskedText.length) {
    const character = maskedText[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return maskedText.length;
}
