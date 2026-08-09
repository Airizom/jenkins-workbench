import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type {
  BuildDiagnosticConsoleReference,
  BuildDiagnosticInsightItem,
  BuildDiagnosticsViewModel
} from "../panels/buildDetails/shared/BuildDetailsContracts";
import { EMPTY_BUILD_DIAGNOSTICS } from "../panels/buildDetails/shared/BuildDetailsContracts";
import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import { stripConsoleControlSequences } from "./BuildDiagnosticConsoleText";
import type { BuildDiagnosticPathResolver } from "./BuildDiagnosticPathResolver";
import type { NormalizedDiagnosticProfile, RawBuildDiagnostic } from "./BuildDiagnosticTypes";

const RESOLUTION_CONCURRENCY = 8;
const MAX_PUBLISHED_PROBLEMS = 500;
const RESOLUTION_CANDIDATE_MULTIPLIER = 4;

export interface BuildDiagnosticSourceTarget {
  id: string;
  uri: vscode.Uri;
  range: vscode.Range;
  generation: number;
  buildUrl: string;
  rawPath: string;
  logLine: number;
}

export interface BuildDiagnosticResolvedReference {
  targetId: string;
  rawPath: string;
  rawText: string;
  logLine: number;
}

export interface BuildDiagnosticPublishedSnapshot {
  viewModel: BuildDiagnosticsViewModel;
  targets: ReadonlyMap<string, BuildDiagnosticSourceTarget>;
  resolvedReferences: readonly BuildDiagnosticResolvedReference[];
}

interface ConsoleReferenceSearchState {
  occupied: Set<string>;
  nextSearchOffsetByPath: Map<string, number>;
  nextSearchOffsetByLine: Map<string, number>;
}

export interface BuildDiagnosticAggregationOptions {
  collection: vscode.DiagnosticCollection;
  pathResolver: BuildDiagnosticPathResolver;
  repositoryUri: vscode.Uri;
  profile: NormalizedDiagnosticProfile;
  diagnostics: readonly RawBuildDiagnostic[];
  omittedCount?: number;
  maxProblems: number;
  generation: number;
  buildUrl: string;
  buildIdentity: string;
  truncated: boolean;
  warnings?: readonly string[];
  isCurrent?: () => boolean;
}

interface ResolvedRawDiagnostic {
  raw: RawBuildDiagnostic;
  uri: vscode.Uri;
  range: vscode.Range;
  target: BuildDiagnosticSourceTarget;
}

interface AggregatedDiagnostic {
  raw: RawBuildDiagnostic;
  uri: vscode.Uri;
  range: vscode.Range;
  related: ResolvedRawDiagnostic[];
  target: BuildDiagnosticSourceTarget;
}

interface AggregatedStackTrace<T> {
  primary: T;
  related: T[];
}

export async function aggregateAndPublishBuildDiagnostics(
  options: BuildDiagnosticAggregationOptions
): Promise<BuildDiagnosticPublishedSnapshot> {
  const maxProblems = getPublishedProblemLimit(options.maxProblems);
  const candidates = selectResolutionCandidates(
    options.diagnostics,
    getBuildDiagnosticCandidateLimit(maxProblems)
  );
  const candidateOmittedCount = Math.max(0, options.diagnostics.length - candidates.length);
  const resolved: ResolvedRawDiagnostic[] = [];
  const unresolved: RawBuildDiagnostic[] = [];
  await forEachConcurrent(candidates, RESOLUTION_CONCURRENCY, async (raw) => {
    const resolution = await options.pathResolver.resolve(
      options.repositoryUri,
      options.profile,
      raw
    );
    if (resolution.status !== "resolved") {
      unresolved.push(raw);
      return;
    }
    const range = toRange(raw);
    resolved.push({
      raw,
      uri: resolution.uri,
      range,
      target: {
        id: randomUUID(),
        uri: resolution.uri,
        range,
        generation: options.generation,
        buildUrl: options.buildUrl,
        rawPath: raw.rawPath,
        logLine: raw.logLine
      }
    });
  });
  resolved.sort(compareResolved);

  if (options.isCurrent && !options.isCurrent()) {
    return {
      viewModel: EMPTY_BUILD_DIAGNOSTICS,
      targets: new Map(),
      resolvedReferences: []
    };
  }

  const aggregated = aggregateStackTraces(resolved);
  const unique = deduplicateDiagnostics(aggregated);
  const resolvedStackIds = new Set(
    resolved
      .map((item) => item.raw.stackTraceId)
      .filter((id): id is string => typeof id === "string")
  );
  const uniqueUnresolved = deduplicateUnresolvedDiagnostics(
    aggregateUnresolvedStackTraces(
      unresolved.filter((raw) => !raw.stackTraceId || !resolvedStackIds.has(raw.stackTraceId))
    )
  );
  const published = unique.slice(0, maxProblems);
  const omittedCount =
    Math.max(0, options.omittedCount ?? 0) +
    candidateOmittedCount +
    Math.max(0, unique.length - published.length);
  publishCollection(options.collection, published, options.buildIdentity);

  const targets = new Map<string, BuildDiagnosticSourceTarget>();
  const resolvedReferences: BuildDiagnosticResolvedReference[] = [];
  for (const item of resolved) {
    targets.set(item.target.id, item.target);
    resolvedReferences.push({
      targetId: item.target.id,
      rawPath: item.raw.rawPath,
      rawText: item.raw.rawText,
      logLine: item.raw.logLine
    });
  }

  const counts = countSeverities([...unique, ...uniqueUnresolved.map((raw) => ({ raw }))]);
  const warnings = [...(options.warnings ?? [])];

  const viewModel: BuildDiagnosticsViewModel = {
    status: options.truncated ? "truncated" : "available",
    errorCount: counts.error,
    warningCount: counts.warning,
    informationCount: counts.information,
    resolvedCount: unique.length,
    unresolvedCount: uniqueUnresolved.length,
    omittedCount,
    items: [
      ...unique.map((item) => ({ raw: item.raw, item: toInsightItem(item) })),
      ...uniqueUnresolved.map((raw) => ({ raw, item: toUnresolvedInsightItem(raw) }))
    ]
      .sort((left, right) => compareRawLogOrder(left.raw, right.raw))
      .slice(0, 5)
      .map((entry) => entry.item),
    warnings,
    consoleReferences: []
  };
  return { viewModel, targets, resolvedReferences };
}

export function getBuildDiagnosticCandidateLimit(maxProblems: number): number {
  return getPublishedProblemLimit(maxProblems) * RESOLUTION_CANDIDATE_MULTIPLIER;
}

function getPublishedProblemLimit(maxProblems: number): number {
  return Math.min(MAX_PUBLISHED_PROBLEMS, Math.max(1, Math.floor(maxProblems)));
}

function selectResolutionCandidates(
  diagnostics: readonly RawBuildDiagnostic[],
  limit: number
): RawBuildDiagnostic[] {
  if (diagnostics.length <= limit) {
    return [...diagnostics];
  }
  const bySeverity: Record<BuildDiagnosticSeverity, RawBuildDiagnostic[]> = {
    error: [],
    warning: [],
    information: []
  };
  for (const diagnostic of diagnostics) {
    const bucket = bySeverity[diagnostic.severity];
    if (bucket.length < limit) {
      bucket.push(diagnostic);
    }
  }
  return [...bySeverity.error, ...bySeverity.warning, ...bySeverity.information].slice(0, limit);
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

function aggregateStackTraces(resolved: readonly ResolvedRawDiagnostic[]): AggregatedDiagnostic[] {
  return aggregateStackTraceGroups(resolved, (item) => item.raw)
    .map(({ primary, related }) => ({ ...primary, related }))
    .sort((left, right) => compareResolved(left, right));
}

function deduplicateDiagnostics(items: readonly AggregatedDiagnostic[]): AggregatedDiagnostic[] {
  const result: AggregatedDiagnostic[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = [
      item.uri.toString(),
      item.range.start.line,
      item.range.start.character,
      item.range.end.line,
      item.range.end.character,
      item.raw.severity,
      item.raw.code ?? "",
      item.raw.message
    ].join("\0");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function aggregateUnresolvedStackTraces(
  diagnostics: readonly RawBuildDiagnostic[]
): RawBuildDiagnostic[] {
  return aggregateStackTraceGroups(diagnostics, (raw) => raw)
    .map(({ primary }) => primary)
    .sort(compareRawLogOrder);
}

function aggregateStackTraceGroups<T>(
  diagnostics: readonly T[],
  getRaw: (diagnostic: T) => RawBuildDiagnostic
): AggregatedStackTrace<T>[] {
  const aggregated: AggregatedStackTrace<T>[] = [];
  const groups = new Map<string, T[]>();
  for (const diagnostic of diagnostics) {
    const raw = getRaw(diagnostic);
    if (raw.kind !== "stack-frame" || !raw.stackTraceId) {
      aggregated.push({ primary: diagnostic, related: [] });
      continue;
    }
    const group = groups.get(raw.stackTraceId) ?? [];
    group.push(diagnostic);
    groups.set(raw.stackTraceId, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (left, right) => (getRaw(left).stackFrameIndex ?? 0) - (getRaw(right).stackFrameIndex ?? 0)
    );
    const primaryIndex = getRaw(group[0]).parserId === "python-traceback" ? group.length - 1 : 0;
    aggregated.push({
      primary: group[primaryIndex],
      related: group.filter((_diagnostic, index) => index !== primaryIndex)
    });
  }
  return aggregated;
}

function deduplicateUnresolvedDiagnostics(
  diagnostics: readonly RawBuildDiagnostic[]
): RawBuildDiagnostic[] {
  const result: RawBuildDiagnostic[] = [];
  const seen = new Set<string>();
  for (const raw of diagnostics) {
    const key = [
      raw.rawPath,
      raw.line,
      raw.column ?? "",
      raw.endLine ?? "",
      raw.endColumn ?? "",
      raw.severity,
      raw.code ?? "",
      raw.message
    ].join("\0");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(raw);
    }
  }
  return result;
}

function publishCollection(
  collection: vscode.DiagnosticCollection,
  diagnostics: readonly AggregatedDiagnostic[],
  buildIdentity: string
): void {
  const grouped = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
  for (const item of diagnostics) {
    const key = item.uri.toString();
    const group = grouped.get(key) ?? { uri: item.uri, diagnostics: [] };
    const diagnostic = new vscode.Diagnostic(
      item.range,
      item.raw.message,
      toVscodeSeverity(item.raw.severity)
    );
    diagnostic.source = `${item.raw.source} · ${buildIdentity}`;
    if (item.raw.code) {
      diagnostic.code = item.raw.code;
    }
    if (item.related.length > 0) {
      diagnostic.relatedInformation = item.related.map(
        (related) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(related.uri, related.range),
            related.raw.message
          )
      );
    }
    group.diagnostics.push(diagnostic);
    grouped.set(key, group);
  }
  collection.clear();
  collection.set([...grouped.values()].map((group) => [group.uri, group.diagnostics]));
}

function toInsightItem(item: AggregatedDiagnostic): BuildDiagnosticInsightItem {
  return {
    severity: item.raw.severity,
    message: item.raw.message,
    locationLabel: `${item.uri.path.split("/").at(-1) ?? item.raw.rawPath}:${item.raw.line}${
      item.raw.column ? `:${item.raw.column}` : ""
    }`,
    source: item.raw.source,
    code: item.raw.code,
    targetId: item.target.id
  };
}

function toUnresolvedInsightItem(raw: RawBuildDiagnostic): BuildDiagnosticInsightItem {
  return {
    severity: raw.severity,
    message: raw.message,
    locationLabel: `${raw.rawPath}:${raw.line}${raw.column ? `:${raw.column}` : ""}`,
    source: raw.source,
    code: raw.code
  };
}

function countSeverities(
  items: readonly { raw: Pick<RawBuildDiagnostic, "severity"> }[]
): Record<BuildDiagnosticSeverity, number> {
  const counts: Record<BuildDiagnosticSeverity, number> = {
    error: 0,
    warning: 0,
    information: 0
  };
  for (const item of items) {
    counts[item.raw.severity] += 1;
  }
  return counts;
}

function toRange(raw: RawBuildDiagnostic): vscode.Range {
  const startLine = Math.max(0, Math.floor(raw.line || 1) - 1);
  const startColumn = Math.max(0, Math.floor(raw.column || 1) - 1);
  const endLine = Math.max(startLine, Math.floor(raw.endLine || raw.line || 1) - 1);
  const requestedEndColumn = raw.endColumn
    ? Math.max(0, Math.floor(raw.endColumn) - 1)
    : startColumn + 1;
  const endColumn =
    endLine === startLine ? Math.max(startColumn + 1, requestedEndColumn) : requestedEndColumn;
  return new vscode.Range(startLine, startColumn, endLine, endColumn);
}

function toVscodeSeverity(severity: BuildDiagnosticSeverity): vscode.DiagnosticSeverity {
  switch (severity) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function compareResolved(
  left: Pick<ResolvedRawDiagnostic, "raw">,
  right: Pick<ResolvedRawDiagnostic, "raw">
): number {
  return (
    severityRank(left.raw.severity) - severityRank(right.raw.severity) ||
    left.raw.logLine - right.raw.logLine ||
    left.raw.priority - right.raw.priority ||
    left.raw.sequence - right.raw.sequence
  );
}

function compareRawLogOrder(
  left: Pick<RawBuildDiagnostic, "logLine" | "priority" | "sequence">,
  right: Pick<RawBuildDiagnostic, "logLine" | "priority" | "sequence">
): number {
  return (
    left.logLine - right.logLine || left.priority - right.priority || left.sequence - right.sequence
  );
}

function severityRank(severity: BuildDiagnosticSeverity): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await callback(items[index]);
    }
  });
  await Promise.all(workers);
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
