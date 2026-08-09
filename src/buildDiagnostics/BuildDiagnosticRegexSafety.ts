const MAX_REGEXP_LENGTH = 2048;

export interface DiagnosticRegexpValidation {
  safe: boolean;
  reason?: string;
  regexp?: RegExp;
}

/**
 * Performs conservative, synchronous validation before a user expression is
 * handed to the bounded custom-matcher runner. This is defense in depth, not a
 * substitute for the worker timeout used by the runtime integration.
 */
export function validateDiagnosticRegexp(source: string): DiagnosticRegexpValidation {
  if (!source) {
    return { safe: false, reason: "Regular expression must not be empty." };
  }
  if (source.length > MAX_REGEXP_LENGTH) {
    return {
      safe: false,
      reason: `Regular expression exceeds the ${MAX_REGEXP_LENGTH} character limit.`
    };
  }

  const unsafeReason = findUnsafeRegexpShape(source);
  if (unsafeReason) {
    return { safe: false, reason: unsafeReason };
  }

  try {
    return { safe: true, regexp: new RegExp(source) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { safe: false, reason: `Invalid regular expression: ${message}` };
  }
}

function findUnsafeRegexpShape(source: string): string | undefined {
  const simplified = stripEscapesAndCharacterClasses(source);

  const repetitionIssue = findUnsafeRepeatedGroup(simplified);
  if (repetitionIssue) {
    return repetitionIssue;
  }
  if (/\\[1-9]/.test(source) && /[+*{]/.test(simplified)) {
    return "Backreferences combined with repetition are not allowed in diagnostic matchers.";
  }

  return undefined;
}

interface RegexpGroupState {
  containsUnboundedRepetition: boolean;
  containsAlternation: boolean;
}

interface RegexpQuantifier {
  endIndex: number;
  unbounded: boolean;
}

interface RegexpScanResult {
  endIndex: number;
  issue?: string;
}

/**
 * Tracks repetition through arbitrarily nested groups. Regexes over the source
 * text miss equivalent forms such as ((a+))+ and braced forms such as
 * (a{1,})+, both of which can catastrophically backtrack.
 */
function findUnsafeRepeatedGroup(source: string): string | undefined {
  const groups: RegexpGroupState[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const result = scanRegexpToken(source, index, groups);
    if (result.issue) {
      return result.issue;
    }
    index = result.endIndex;
  }
  return undefined;
}

function scanRegexpToken(
  source: string,
  index: number,
  groups: RegexpGroupState[]
): RegexpScanResult {
  const char = source[index];
  if (char === "(") {
    groups.push({ containsUnboundedRepetition: false, containsAlternation: false });
    return { endIndex: index };
  }
  if (char === "|") {
    markAlternation(groups);
    return { endIndex: index };
  }
  if (char === ")") {
    return closeRegexpGroup(source, index, groups);
  }
  return isQuantifierCharacter(char) ? { endIndex: index } : scanRegexpAtom(source, index, groups);
}

function markAlternation(groups: RegexpGroupState[]): void {
  const current = groups.at(-1);
  if (current) {
    current.containsAlternation = true;
  }
}

function closeRegexpGroup(
  source: string,
  index: number,
  groups: RegexpGroupState[]
): RegexpScanResult {
  const closed = groups.pop();
  if (!closed) {
    return { endIndex: index };
  }
  const quantifier = readRegexpQuantifier(source, index + 1);
  const issue = findRepeatedGroupIssue(closed, quantifier);
  if (issue) {
    return { endIndex: index, issue };
  }
  propagateGroupRepetition(groups, closed, quantifier);
  return { endIndex: quantifier?.endIndex ?? index };
}

function findRepeatedGroupIssue(
  group: RegexpGroupState,
  quantifier: RegexpQuantifier | undefined
): string | undefined {
  if (quantifier && group.containsUnboundedRepetition) {
    return "Nested repetition is not allowed in diagnostic matchers.";
  }
  if (quantifier && group.containsAlternation) {
    return "Repeated alternation is not allowed in diagnostic matchers.";
  }
  return undefined;
}

function propagateGroupRepetition(
  groups: RegexpGroupState[],
  closed: RegexpGroupState,
  quantifier: RegexpQuantifier | undefined
): void {
  const parent = groups.at(-1);
  if (parent && (closed.containsUnboundedRepetition || quantifier?.unbounded)) {
    parent.containsUnboundedRepetition = true;
  }
}

function scanRegexpAtom(
  source: string,
  index: number,
  groups: RegexpGroupState[]
): RegexpScanResult {
  const quantifier = readRegexpQuantifier(source, index + 1);
  if (!quantifier) {
    return { endIndex: index };
  }
  if (quantifier.unbounded) {
    markUnboundedRepetition(groups);
  }
  return { endIndex: quantifier.endIndex };
}

function markUnboundedRepetition(groups: RegexpGroupState[]): void {
  const current = groups.at(-1);
  if (current) {
    current.containsUnboundedRepetition = true;
  }
}

function isQuantifierCharacter(char: string): boolean {
  return char === "*" || char === "+" || char === "{" || char === "}";
}

function readRegexpQuantifier(source: string, startIndex: number): RegexpQuantifier | undefined {
  const char = source[startIndex];
  if (char === "*" || char === "+") {
    return {
      endIndex: source[startIndex + 1] === "?" ? startIndex + 1 : startIndex,
      unbounded: true
    };
  }
  if (char !== "{") {
    return undefined;
  }
  const closingIndex = source.indexOf("}", startIndex + 1);
  if (closingIndex < 0) {
    return undefined;
  }
  const body = source.slice(startIndex + 1, closingIndex);
  const bounds = body.match(/^(\d+)(?:,(\d*))?$/);
  if (!bounds) {
    return undefined;
  }
  const lazy = source[closingIndex + 1] === "?";
  return {
    endIndex: lazy ? closingIndex + 1 : closingIndex,
    unbounded: body.includes(",") && bounds[2] === ""
  };
}

function stripEscapesAndCharacterClasses(source: string): string {
  let result = "";
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      result += "__";
      index += 1;
      continue;
    }
    if (char === "[") {
      inClass = true;
      result += "_";
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      result += "_";
      continue;
    }
    result += inClass ? "_" : char;
  }
  return result;
}
