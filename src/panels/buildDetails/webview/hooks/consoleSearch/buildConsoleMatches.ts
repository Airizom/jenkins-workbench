import type { ConsoleMatch, ConsoleMatchState } from "./consoleSearchTypes";
import { MAX_CONSOLE_MATCHES } from "./constants";

const MAX_REGEX_SEARCH_TEXT_LENGTH = 200_000;
const MAX_REGEX_PATTERN_LENGTH = 300;
const MAX_REGEX_QUANTIFIERS = 8;
const MAX_REPEATED_QUANTIFIED_ATOMS = 4;
const UNSAFE_REGEX_MESSAGE =
  "Regex search was skipped because this pattern can be too slow for large console logs.";

type GroupFrame = {
  hasAlternation: boolean;
  hasQuantifier: boolean;
  isLookaround: boolean;
};

type PendingAtom = {
  signature: string;
  group?: GroupFrame;
};

export function buildConsoleMatches(
  text: string,
  query: string,
  useRegex: boolean
): ConsoleMatchState {
  if (!query) {
    return { matches: [], tooManyMatches: false };
  }

  if (useRegex) {
    let regex: RegExp;
    try {
      regex = new RegExp(query, "g");
    } catch (error) {
      return {
        matches: [],
        tooManyMatches: false,
        error: error instanceof Error ? error.message : "Invalid regular expression."
      };
    }

    const safetyError = getRegexSafetyError(text, query);
    if (safetyError) {
      return { matches: [], tooManyMatches: false, error: safetyError };
    }

    const matches: ConsoleMatch[] = [];
    let tooManyMatches = false;
    let match = regex.exec(text);

    while (match) {
      const matchText = match[0] ?? "";
      if (matchText.length === 0) {
        regex.lastIndex = match.index + 1;
        match = regex.exec(text);
        continue;
      }

      matches.push({ start: match.index, end: match.index + matchText.length });
      if (matches.length >= MAX_CONSOLE_MATCHES) {
        tooManyMatches = true;
        break;
      }

      match = regex.exec(text);
    }

    return { matches, tooManyMatches };
  }

  const matches: ConsoleMatch[] = [];
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let startIndex = 0;
  let tooManyMatches = false;

  while (startIndex < normalizedText.length) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, startIndex);
    if (nextIndex === -1) {
      break;
    }

    matches.push({ start: nextIndex, end: nextIndex + normalizedQuery.length });
    if (matches.length >= MAX_CONSOLE_MATCHES) {
      tooManyMatches = true;
      break;
    }

    startIndex = nextIndex + Math.max(1, normalizedQuery.length);
  }

  return { matches, tooManyMatches };
}

function getRegexSafetyError(text: string, query: string): string | undefined {
  if (text.length > MAX_REGEX_SEARCH_TEXT_LENGTH) {
    return `Regex search is limited to ${MAX_REGEX_SEARCH_TEXT_LENGTH.toLocaleString()} console characters. Use plain text search or narrow the log.`;
  }
  if (query.length > MAX_REGEX_PATTERN_LENGTH) {
    return `Regex search is limited to ${MAX_REGEX_PATTERN_LENGTH.toLocaleString()} pattern characters.`;
  }
  if (hasBackreference(query) || hasUnsafeRegexShape(query)) {
    return UNSAFE_REGEX_MESSAGE;
  }
  return undefined;
}

function hasBackreference(query: string): boolean {
  let inCharacterClass = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    if (char === "\\") {
      const next = query[index + 1] ?? "";
      if (!inCharacterClass && (/^[1-9]$/.test(next) || next === "k")) {
        return true;
      }
      index += 1;
      continue;
    }
    if (char === "[" && !inCharacterClass) {
      inCharacterClass = true;
      continue;
    }
    if (char === "]" && inCharacterClass) {
      inCharacterClass = false;
    }
  }

  return false;
}

function hasUnsafeRegexShape(query: string): boolean {
  const groups: GroupFrame[] = [];
  let pendingAtom: PendingAtom | undefined;
  let previousQuantifiedAtom: { signature: string; count: number } | undefined;
  let quantifierCount = 0;

  const resetQuantifiedAtomRun = () => {
    previousQuantifiedAtom = undefined;
  };
  const flushPendingAtom = () => {
    if (pendingAtom) {
      pendingAtom = undefined;
      resetQuantifiedAtomRun();
    }
  };
  const beginAtom = (atom: PendingAtom) => {
    flushPendingAtom();
    pendingAtom = atom;
  };
  const markOpenGroupsWithQuantifier = () => {
    for (const group of groups) {
      group.hasQuantifier = true;
    }
  };
  const markOpenGroupsWithAlternation = () => {
    for (const group of groups) {
      group.hasAlternation = true;
    }
  };
  const recordQuantifiedAtom = (signature: string): boolean => {
    if (previousQuantifiedAtom?.signature === signature) {
      previousQuantifiedAtom.count += 1;
    } else {
      previousQuantifiedAtom = { signature, count: 1 };
    }
    return previousQuantifiedAtom.count >= MAX_REPEATED_QUANTIFIED_ATOMS;
  };

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];
    const quantifierLength = readQuantifierLength(query, index);

    if (quantifierLength > 0 && pendingAtom) {
      quantifierCount += 1;
      if (quantifierCount > MAX_REGEX_QUANTIFIERS) {
        return true;
      }

      markOpenGroupsWithQuantifier();
      if (
        pendingAtom.group &&
        (pendingAtom.group.hasAlternation ||
          pendingAtom.group.hasQuantifier ||
          pendingAtom.group.isLookaround)
      ) {
        return true;
      }
      if (recordQuantifiedAtom(pendingAtom.signature)) {
        return true;
      }

      pendingAtom = undefined;
      index += quantifierLength - 1;
      continue;
    }
    if (quantifierLength > 0) {
      index += quantifierLength - 1;
      continue;
    }

    if (char === "\\") {
      const escapedAtom = readEscapedAtom(query, index);
      if (escapedAtom.atom) {
        beginAtom(escapedAtom.atom);
      } else {
        flushPendingAtom();
      }
      index = escapedAtom.endIndex;
      continue;
    }

    if (char === "[") {
      const classEnd = readCharacterClassEnd(query, index);
      beginAtom({ signature: `class:${query.slice(index, classEnd + 1)}` });
      index = classEnd;
      continue;
    }

    if (char === "(") {
      flushPendingAtom();
      const groupPrefix = readGroupPrefix(query, index);
      if (groupPrefix.isLookaround) {
        return true;
      }
      groups.push({ hasAlternation: false, hasQuantifier: false, isLookaround: false });
      index += groupPrefix.length;
      continue;
    }

    if (char === ")") {
      flushPendingAtom();
      const group = groups.pop();
      if (group) {
        pendingAtom = { signature: "group", group };
      }
      continue;
    }

    if (char === "|") {
      flushPendingAtom();
      markOpenGroupsWithAlternation();
      continue;
    }

    if (char === "^" || char === "$") {
      flushPendingAtom();
      continue;
    }

    beginAtom({ signature: char === "." ? "dot" : `literal:${char}` });
  }

  return false;
}

function readQuantifierLength(query: string, index: number): number {
  const char = query[index];
  if (char === "*" || char === "+" || char === "?") {
    return 1;
  }
  if (char !== "{") {
    return 0;
  }

  const endIndex = query.indexOf("}", index + 1);
  if (endIndex === -1) {
    return 0;
  }

  const body = query.slice(index + 1, endIndex);
  return /^\d+(?:,\d*)?$/.test(body) ? endIndex - index + 1 : 0;
}

function readEscapedAtom(query: string, index: number): { atom?: PendingAtom; endIndex: number } {
  const escaped = query[index + 1];
  if (!escaped) {
    return { endIndex: index };
  }
  if (escaped === "b" || escaped === "B") {
    return { endIndex: index + 1 };
  }
  if ((escaped === "p" || escaped === "P") && query[index + 2] === "{") {
    const propertyEnd = query.indexOf("}", index + 3);
    if (propertyEnd !== -1) {
      return {
        atom: { signature: `class:${query.slice(index, propertyEnd + 1)}` },
        endIndex: propertyEnd
      };
    }
  }
  const signature = /^[dDsSwW]$/.test(escaped) ? `class:${escaped}` : `literal:${escaped}`;
  return { atom: { signature }, endIndex: index + 1 };
}

function readCharacterClassEnd(query: string, index: number): number {
  for (let cursor = index + 1; cursor < query.length; cursor += 1) {
    if (query[cursor] === "\\") {
      cursor += 1;
      continue;
    }
    if (query[cursor] === "]") {
      return cursor;
    }
  }
  return query.length - 1;
}

function readGroupPrefix(query: string, index: number): { length: number; isLookaround: boolean } {
  if (query[index + 1] !== "?") {
    return { length: 0, isLookaround: false };
  }

  const marker = query[index + 2];
  if (marker === ":" || marker === "=" || marker === "!") {
    return { length: 2, isLookaround: marker === "=" || marker === "!" };
  }
  if (marker === "<") {
    const lookbehindMarker = query[index + 3];
    if (lookbehindMarker === "=" || lookbehindMarker === "!") {
      return { length: 3, isLookaround: true };
    }

    const nameEnd = query.indexOf(">", index + 3);
    return { length: nameEnd === -1 ? 1 : nameEnd - index, isLookaround: false };
  }

  return { length: 1, isLookaround: false };
}
