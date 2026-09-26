const MAX_REGEXP_LENGTH = 2048;

export interface DiagnosticRegexpValidation {
  safe: boolean;
  reason?: string;
  regexp?: RegExp;
}

/**
 * Performs conservative, synchronous validation before a user expression is
 * used by path mappings or handed to the bounded custom-matcher runner. Path
 * mappings execute on the extension host, so their expressions must pass this
 * check before matching diagnostic paths.
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
  startIndex: number;
  containsVariableRepetition: boolean;
  containsAlternation: boolean;
  containsConsumingAtom: boolean;
  lastAtomVariableRepetition: boolean;
}

interface RegexpQuantifier {
  endIndex: number;
  variable: boolean;
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
  const groups: RegexpGroupState[] = [newRegexpGroupState(-1)];
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
    groups.push(newRegexpGroupState(index));
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
    current.lastAtomVariableRepetition = false;
  }
}

function newRegexpGroupState(startIndex: number): RegexpGroupState {
  return {
    startIndex,
    containsVariableRepetition: false,
    containsAlternation: false,
    containsConsumingAtom: false,
    lastAtomVariableRepetition: false
  };
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
  const body = source.slice(closed.startIndex + 1, index);
  if (body === "" || body === "?:") {
    return { endIndex: quantifier?.endIndex ?? index };
  }
  const issue = findRepeatedGroupIssue(closed, quantifier);
  if (issue) {
    return { endIndex: index, issue };
  }
  if (/^\?(?:[=!]|<[=!])/.test(body)) {
    // Assertions consume no input, so they cannot separate repeated atoms.
    return quantifier
      ? {
          endIndex: quantifier.endIndex,
          issue: "Quantified assertions are not allowed in diagnostic matchers."
        }
      : { endIndex: index };
  }
  const adjacentIssue = propagateGroupRepetition(groups, closed, quantifier);
  return { endIndex: quantifier?.endIndex ?? index, issue: adjacentIssue };
}

function findRepeatedGroupIssue(
  group: RegexpGroupState,
  quantifier: RegexpQuantifier | undefined
): string | undefined {
  if (quantifier && group.containsVariableRepetition) {
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
): string | undefined {
  const parent = groups.at(-1);
  if (!parent || !closed.containsConsumingAtom) {
    return undefined;
  }
  parent.containsConsumingAtom = true;
  return recordRegexpAtom(
    parent,
    closed.containsVariableRepetition || Boolean(quantifier?.variable)
  );
}

function scanRegexpAtom(
  source: string,
  index: number,
  groups: RegexpGroupState[]
): RegexpScanResult {
  const group = groups.at(-1);
  const prefix = group?.startIndex ?? -1;
  if (
    source.slice(prefix, prefix + 3) === "(?:" &&
    (index === prefix + 1 || index === prefix + 2)
  ) {
    return { endIndex: index };
  }
  if (group && source[index] !== "^" && source[index] !== "$") {
    group.containsConsumingAtom = true;
  }
  const quantifier = readRegexpQuantifier(source, index + 1);
  if (!quantifier) {
    return { endIndex: index, issue: recordRegexpAtom(groups.at(-1), false) };
  }
  return {
    endIndex: quantifier.endIndex,
    issue: recordRegexpAtom(groups.at(-1), quantifier.variable)
  };
}

function recordRegexpAtom(
  group: RegexpGroupState | undefined,
  variable: boolean
): string | undefined {
  if (!group) {
    return undefined;
  }
  const adjacent = variable && group.lastAtomVariableRepetition;
  group.containsVariableRepetition ||= variable;
  group.lastAtomVariableRepetition = variable;
  return adjacent ? "Adjacent repetition is not allowed in diagnostic matchers." : undefined;
}

function isQuantifierCharacter(char: string): boolean {
  return char === "*" || char === "+" || char === "?" || char === "{" || char === "}";
}

function readRegexpQuantifier(source: string, startIndex: number): RegexpQuantifier | undefined {
  const char = source[startIndex];
  if (char === "*" || char === "+" || char === "?") {
    return {
      endIndex: char !== "?" && source[startIndex + 1] === "?" ? startIndex + 1 : startIndex,
      variable: true
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
  const minimum = normalizeDecimalBound(bounds[1]);
  const maximum =
    bounds[2] === undefined || bounds[2] === "" ? bounds[2] : normalizeDecimalBound(bounds[2]);
  return {
    endIndex: lazy ? closingIndex + 1 : closingIndex,
    variable: maximum === "" || (maximum !== undefined && minimum !== maximum)
  };
}

function normalizeDecimalBound(bound: string): string {
  return bound.replace(/^0+(?=\d)/, "");
}

function stripEscapesAndCharacterClasses(source: string): string {
  let result = "";
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      if (!inClass) {
        result += "_";
      }
      index += 1;
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      result += "_";
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass) {
      result += char;
    }
  }
  return result;
}
