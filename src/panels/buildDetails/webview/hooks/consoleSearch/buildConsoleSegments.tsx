import * as React from "react";
import type { ConsoleMatch } from "./consoleSearchTypes";

export function buildConsoleSegments(
  consoleText: string,
  matches: ConsoleMatch[],
  activeMatchIndex: number,
  isSearchActive: boolean
): React.ReactNode[] {
  if (!isSearchActive || matches.length === 0) {
    return [consoleText];
  }

  const segments: React.ReactNode[] = [];
  let lastIndex = 0;

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match.start > lastIndex) {
      segments.push(consoleText.slice(lastIndex, match.start));
    }

    const matchText = consoleText.slice(match.start, match.end);
    segments.push(
      <mark
        className={`console-match${index === activeMatchIndex ? " console-match--active" : ""}`}
        data-match-index={index}
        key={`console-match-${match.start}-${match.end}`}
      >
        {matchText}
      </mark>
    );

    lastIndex = match.end;
  }

  if (lastIndex < consoleText.length) {
    segments.push(consoleText.slice(lastIndex));
  }

  return segments;
}
