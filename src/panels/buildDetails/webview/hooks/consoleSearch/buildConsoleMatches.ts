import type { ConsoleMatch, ConsoleMatchState } from "./consoleSearchTypes";
import { MAX_CONSOLE_MATCHES } from "./constants";

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
