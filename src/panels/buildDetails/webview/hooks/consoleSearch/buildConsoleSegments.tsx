import * as React from "react";
import type { BuildDiagnosticConsoleReference } from "../../../shared/BuildDetailsContracts";
import type { ConsoleMatch } from "./consoleSearchTypes";

export function buildConsoleSegments(
  consoleText: string,
  matches: ConsoleMatch[],
  activeMatchIndex: number,
  isSearchActive: boolean,
  sourceReferences: BuildDiagnosticConsoleReference[] = [],
  onOpenDiagnosticSource?: (targetId: string) => void
): React.ReactNode[] {
  const validMatches = isSearchActive ? matches : [];
  const references = normalizeConsoleSourceReferences(sourceReferences, consoleText.length);
  if (validMatches.length === 0 && references.length === 0) {
    return [consoleText];
  }

  const boundaries = buildConsoleBoundaries(consoleText.length, validMatches, references);
  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  let matchIndex = 0;
  let referenceIndex = 0;
  const segments: React.ReactNode[] = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    while (matchIndex < validMatches.length && validMatches[matchIndex].end <= start) {
      matchIndex += 1;
    }
    while (referenceIndex < references.length && references[referenceIndex].endOffset <= start) {
      referenceIndex += 1;
    }
    segments.push(
      renderConsoleSegment({
        consoleText,
        start,
        end,
        match: validMatches[matchIndex],
        matchIndex,
        activeMatchIndex,
        reference: references[referenceIndex],
        onOpenDiagnosticSource
      })
    );
  }
  return segments;
}

function buildConsoleBoundaries(
  textLength: number,
  matches: readonly ConsoleMatch[],
  references: readonly BuildDiagnosticConsoleReference[]
): Set<number> {
  const boundaries = new Set<number>([0, textLength]);
  for (const match of matches) {
    boundaries.add(match.start);
    boundaries.add(match.end);
  }
  for (const reference of references) {
    boundaries.add(reference.startOffset);
    boundaries.add(reference.endOffset);
  }
  return boundaries;
}

function renderConsoleSegment(options: {
  consoleText: string;
  start: number;
  end: number;
  match?: ConsoleMatch;
  matchIndex: number;
  activeMatchIndex: number;
  reference?: BuildDiagnosticConsoleReference;
  onOpenDiagnosticSource?: (targetId: string) => void;
}): React.ReactNode {
  let content: React.ReactNode = options.consoleText.slice(options.start, options.end);
  if (coversRange(options.match, options.start, options.end)) {
    content = (
      <mark
        className={`console-match${
          options.matchIndex === options.activeMatchIndex ? " console-match--active" : ""
        }`}
        data-match-index={options.matchIndex}
      >
        {content}
      </mark>
    );
  }
  if (
    coversReferenceRange(options.reference, options.start, options.end) &&
    options.onOpenDiagnosticSource
  ) {
    const targetId = options.reference.targetId;
    content = (
      <button
        type="button"
        className="console-source-link"
        data-source-target-id={targetId}
        title="Open local source"
        onClick={() => options.onOpenDiagnosticSource?.(targetId)}
      >
        {content}
      </button>
    );
  }
  return (
    <React.Fragment key={`console-segment-${options.start}-${options.end}`}>
      {content}
    </React.Fragment>
  );
}

function coversRange(match: ConsoleMatch | undefined, start: number, end: number): boolean {
  return Boolean(match && match.start <= start && match.end >= end);
}

function coversReferenceRange(
  reference: BuildDiagnosticConsoleReference | undefined,
  start: number,
  end: number
): reference is BuildDiagnosticConsoleReference {
  return Boolean(reference && reference.startOffset <= start && reference.endOffset >= end);
}

export function normalizeConsoleSourceReferences(
  references: BuildDiagnosticConsoleReference[],
  textLength: number
): BuildDiagnosticConsoleReference[] {
  const sorted = references
    .filter(
      (reference) =>
        Number.isSafeInteger(reference.startOffset) &&
        Number.isSafeInteger(reference.endOffset) &&
        reference.startOffset >= 0 &&
        reference.endOffset > reference.startOffset &&
        reference.endOffset <= textLength &&
        reference.targetId.trim().length > 0
    )
    .sort(
      (left, right) =>
        left.startOffset - right.startOffset ||
        left.endOffset - right.endOffset ||
        left.targetId.localeCompare(right.targetId)
    );
  const nonOverlapping: BuildDiagnosticConsoleReference[] = [];
  let previousEnd = -1;
  for (const reference of sorted) {
    if (reference.startOffset < previousEnd) {
      continue;
    }
    nonOverlapping.push(reference);
    previousEnd = reference.endOffset;
  }
  return nonOverlapping;
}
