import { isSafePattern } from "redos-detector";
import type { ConsoleMatch, ConsoleMatchState } from "./consoleSearchTypes";
import { MAX_CONSOLE_MATCHES } from "./constants";

const MAX_REGEX_SEARCH_TEXT_LENGTH = 200_000;
const MAX_REGEX_PATTERN_LENGTH = 300;
const MAX_REGEX_ANALYSIS_SCORE = 200;
const MAX_REGEX_ANALYSIS_STEPS = 500;
const UNSAFE_REGEX_MESSAGE =
  "Regex search was skipped because this pattern can be too slow for large console logs.";

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
      // Case-insensitive, like plain-text search.
      regex = new RegExp(query, "gi");
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

      if (matches.length >= MAX_CONSOLE_MATCHES) {
        tooManyMatches = true;
        break;
      }
      matches.push({ start: match.index, end: match.index + matchText.length });

      match = regex.exec(text);
    }

    return { matches, tooManyMatches };
  }

  const matches: ConsoleMatch[] = [];
  const { normalizedText, sourceStarts, sourceEnds } = buildPlainTextSearchIndex(text);
  const normalizedQuery = query.toLowerCase();
  let startIndex = 0;
  let tooManyMatches = false;

  while (startIndex < normalizedText.length) {
    const nextIndex = normalizedText.indexOf(normalizedQuery, startIndex);
    if (nextIndex === -1) {
      break;
    }

    const endIndex = nextIndex + normalizedQuery.length - 1;
    if (matches.length >= MAX_CONSOLE_MATCHES) {
      tooManyMatches = true;
      break;
    }
    matches.push({ start: sourceStarts[nextIndex], end: sourceEnds[endIndex] });

    startIndex = nextIndex + Math.max(1, normalizedQuery.length);
  }

  return { matches, tooManyMatches };
}

function buildPlainTextSearchIndex(text: string): {
  normalizedText: string;
  sourceStarts: number[];
  sourceEnds: number[];
} {
  let normalizedText = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  let sourceIndex = 0;

  for (const char of text) {
    const folded = char.toLowerCase();
    const start = sourceIndex;
    const end = start + char.length;
    normalizedText += folded;

    for (let index = 0; index < folded.length; index += 1) {
      sourceStarts.push(start);
      sourceEnds.push(end);
    }

    sourceIndex = end;
  }

  return { normalizedText, sourceStarts, sourceEnds };
}

function getRegexSafetyError(text: string, query: string): string | undefined {
  if (text.length > MAX_REGEX_SEARCH_TEXT_LENGTH) {
    return `Regex search is limited to ${MAX_REGEX_SEARCH_TEXT_LENGTH.toLocaleString()} console characters. Use plain text search or narrow the log.`;
  }
  if (query.length > MAX_REGEX_PATTERN_LENGTH) {
    return `Regex search is limited to ${MAX_REGEX_PATTERN_LENGTH.toLocaleString()} pattern characters.`;
  }
  if (!isConsoleRegexSafe(query)) {
    return UNSAFE_REGEX_MESSAGE;
  }
  return undefined;
}

function isConsoleRegexSafe(query: string): boolean {
  try {
    return isSafePattern(query, {
      maxScore: MAX_REGEX_ANALYSIS_SCORE,
      maxSteps: MAX_REGEX_ANALYSIS_STEPS
    }).safe;
  } catch {
    return false;
  }
}
