import type { BuildDiagnosticConsoleReference } from "../panels/buildDetails/shared/BuildDetailsContracts";
import { stripConsoleControlSequences } from "./BuildDiagnosticConsoleText";

export interface BuildDiagnosticResolvedReference {
  targetId: string;
  rawPath: string;
  rawText: string;
  logLine: number;
}

interface ConsoleReferenceSearchState {
  occupied: Set<string>;
  nextSearchOffsetByPath: Map<string, number>;
  nextSearchOffsetByLine: Map<string, number>;
}

export function buildConsoleReferences(
  consoleText: string,
  references: readonly BuildDiagnosticResolvedReference[]
): BuildDiagnosticConsoleReference[] {
  if (!consoleText || references.length === 0) {
    return [];
  }
  const result: BuildDiagnosticConsoleReference[] = [];
  const state: ConsoleReferenceSearchState = {
    occupied: new Set(),
    nextSearchOffsetByPath: new Map(),
    nextSearchOffsetByLine: new Map()
  };
  const orderedReferences = [...references].sort(
    (left, right) => left.logLine - right.logLine || left.rawPath.localeCompare(right.rawPath)
  );
  for (const reference of orderedReferences) {
    const located = locateConsoleReference(consoleText, reference, state);
    if (located) {
      result.push(located);
    }
  }
  return result.sort((left, right) => left.startOffset - right.startOffset);
}

function locateConsoleReference(
  consoleText: string,
  reference: BuildDiagnosticResolvedReference,
  state: ConsoleReferenceSearchState
): BuildDiagnosticConsoleReference | undefined {
  const lineStart = findLineScopedPathStart(consoleText, reference, state);
  if (lineStart === null) {
    return undefined;
  }
  const start = findAvailablePathStart(consoleText, reference.rawPath, lineStart, state);
  return claimConsoleReference(reference.targetId, reference.rawPath, start, state);
}

function findLineScopedPathStart(
  consoleText: string,
  reference: BuildDiagnosticResolvedReference,
  state: ConsoleReferenceSearchState
): number | null | undefined {
  const normalizedLine = stripConsoleControlSequences(reference.rawText).replace(/\r$/, "");
  const pathOffsetInLine = normalizedLine.indexOf(reference.rawPath);
  if (!normalizedLine || pathOffsetInLine < 0) {
    return undefined;
  }
  const lineStart = consoleText.indexOf(
    normalizedLine,
    state.nextSearchOffsetByLine.get(normalizedLine) ?? 0
  );
  if (lineStart < 0) {
    return null;
  }
  state.nextSearchOffsetByLine.set(normalizedLine, lineStart + normalizedLine.length);
  return lineStart + pathOffsetInLine;
}

function findAvailablePathStart(
  consoleText: string,
  rawPath: string,
  lineStart: number | undefined,
  state: ConsoleReferenceSearchState
): number {
  const lineKey = typeof lineStart === "number" ? rangeKey(lineStart, rawPath.length) : undefined;
  if (typeof lineStart === "number" && lineKey && !state.occupied.has(lineKey)) {
    return lineStart;
  }
  const next = findUnoccupiedOccurrence(
    consoleText,
    rawPath,
    state.nextSearchOffsetByPath.get(rawPath) ?? 0,
    state.occupied
  );
  return next >= 0 ? next : findUnoccupiedOccurrence(consoleText, rawPath, 0, state.occupied);
}

function claimConsoleReference(
  targetId: string,
  rawPath: string,
  start: number,
  state: ConsoleReferenceSearchState
): BuildDiagnosticConsoleReference | undefined {
  if (start < 0) {
    return undefined;
  }
  const end = start + rawPath.length;
  const key = rangeKey(start, rawPath.length);
  if (end <= start || state.occupied.has(key)) {
    return undefined;
  }
  state.occupied.add(key);
  state.nextSearchOffsetByPath.set(rawPath, end);
  return { targetId, startOffset: start, endOffset: end };
}

function rangeKey(start: number, length: number): string {
  return `${start}:${start + length}`;
}

function findUnoccupiedOccurrence(
  text: string,
  needle: string,
  fromOffset: number,
  occupied: ReadonlySet<string>
): number {
  let offset = Math.max(0, fromOffset);
  for (;;) {
    const start = text.indexOf(needle, offset);
    if (start < 0) {
      return -1;
    }
    const end = start + needle.length;
    if (!occupied.has(`${start}:${end}`)) {
      return start;
    }
    offset = Math.max(end, start + 1);
  }
}
