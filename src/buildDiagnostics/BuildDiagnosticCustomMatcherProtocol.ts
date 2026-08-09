import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import {
  type DiagnosticRegexpValidation,
  validateDiagnosticRegexp
} from "./BuildDiagnosticRegexSafety";
import {
  BUILT_IN_DIAGNOSTIC_PARSER_IDS,
  type CustomDiagnosticPatternKind,
  type NormalizedCustomDiagnosticMatcher,
  type NormalizedCustomDiagnosticPattern,
  type RawBuildDiagnostic
} from "./BuildDiagnosticTypes";

export const CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION = 1;
export const MAX_CUSTOM_MATCHERS = 64;
export const MAX_CUSTOM_MATCHER_PATTERNS = 16;
export const MAX_CUSTOM_MATCHER_BATCH_CHARS = 1024 * 1024;
export const MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH = 10_000;
export const MAX_CUSTOM_MATCHER_METADATA_LENGTH = 256;

export const MAX_CUSTOM_MATCHER_CAPTURE_INDEX = 100;
export const CUSTOM_MATCHER_CAPTURE_PROPERTIES = [
  "file",
  "location",
  "line",
  "column",
  "endLine",
  "endColumn",
  "severity",
  "code",
  "message"
] as const;

const BUILT_IN_IDS = new Set<string>(BUILT_IN_DIAGNOSTIC_PARSER_IDS);

export type SerializedCustomDiagnosticPattern = Omit<NormalizedCustomDiagnosticPattern, "regexp">;

export interface SerializedCustomDiagnosticMatcher
  extends Omit<NormalizedCustomDiagnosticMatcher, "patterns"> {
  patterns: SerializedCustomDiagnosticPattern[];
}

export interface CustomMatcherWorkerData {
  protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
  matchers: SerializedCustomDiagnosticMatcher[];
  maxBatchChars: number;
}

export interface ParsedCustomMatcherWorkerData extends Omit<CustomMatcherWorkerData, "matchers"> {
  matchers: NormalizedCustomDiagnosticMatcher[];
}

export type CustomMatcherWorkerRequest =
  | {
      protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
      id: number;
      type: "acceptChunk";
      chunk: string;
    }
  | {
      protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
      id: number;
      type: "finish";
    };

export type CustomMatcherWorkerResponse =
  | {
      protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
      id: number;
      ok: true;
      diagnostics: RawBuildDiagnostic[];
    }
  | {
      protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
      id: number;
      ok: false;
      error: string;
    };

/**
 * Copies only matcher primitives needed by the parser. RegExp instances and
 * all profile, environment, repository, credential, and filesystem data are
 * deliberately excluded from the worker payload.
 */
export function serializeCustomDiagnosticMatchers(
  matchers: readonly NormalizedCustomDiagnosticMatcher[]
): SerializedCustomDiagnosticMatcher[] {
  if (matchers.length > MAX_CUSTOM_MATCHERS) {
    throw new Error(`Custom matcher count exceeds the ${MAX_CUSTOM_MATCHERS} matcher limit.`);
  }
  return matchers.map((matcher) => ({
    id: matcher.id,
    source: matcher.source,
    severity: matcher.severity,
    base: matcher.base,
    patterns: matcher.patterns.map((pattern) => ({
      regexpSource: pattern.regexpSource,
      kind: pattern.kind,
      file: pattern.file,
      location: pattern.location,
      line: pattern.line,
      column: pattern.column,
      endLine: pattern.endLine,
      endColumn: pattern.endColumn,
      severity: pattern.severity,
      code: pattern.code,
      message: pattern.message,
      loop: pattern.loop
    }))
  }));
}

export function deserializeCustomDiagnosticMatchers(
  value: unknown
): NormalizedCustomDiagnosticMatcher[] {
  return deserializeMatchers(value);
}

export function validateCustomMatcherPatternRegexp(source: string): DiagnosticRegexpValidation {
  return validateDiagnosticRegexp(source);
}

export function isCustomMatcherPatternKind(value: unknown): value is CustomDiagnosticPatternKind {
  return value === "file" || value === "location";
}

export function isCustomMatcherCaptureIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_CUSTOM_MATCHER_CAPTURE_INDEX
  );
}

export function isCustomMatcherLoop(value: unknown): value is boolean | undefined {
  return typeof value === "undefined" || typeof value === "boolean";
}

export function isCustomMatcherLoopAllowed(value: unknown, isFinal: boolean): boolean {
  return isCustomMatcherLoop(value) && (!value || isFinal);
}

export function createNormalizedCustomDiagnosticPattern(
  value: Record<string, unknown>,
  regexpSource: string,
  regexp: RegExp,
  kind: CustomDiagnosticPatternKind,
  loop: boolean | undefined
): NormalizedCustomDiagnosticPattern {
  return {
    regexpSource,
    regexp,
    kind,
    file: value.file as number | undefined,
    location: value.location as number | undefined,
    line: value.line as number | undefined,
    column: value.column as number | undefined,
    endLine: value.endLine as number | undefined,
    endColumn: value.endColumn as number | undefined,
    severity: value.severity as number | undefined,
    code: value.code as number | undefined,
    message: value.message as number | undefined,
    loop
  };
}

export function parseCustomMatcherWorkerData(value: unknown): ParsedCustomMatcherWorkerData {
  if (!isRecord(value)) {
    throw new Error("Custom matcher worker data must be an object.");
  }
  if (value.protocolVersion !== CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION) {
    throw new Error("Unsupported custom matcher worker protocol version.");
  }
  if (
    typeof value.maxBatchChars !== "number" ||
    !Number.isSafeInteger(value.maxBatchChars) ||
    value.maxBatchChars < 1 ||
    value.maxBatchChars > MAX_CUSTOM_MATCHER_BATCH_CHARS
  ) {
    throw new Error("Invalid custom matcher worker batch limit.");
  }
  return {
    protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
    matchers: deserializeMatchers(value.matchers),
    maxBatchChars: value.maxBatchChars
  };
}

export function parseCustomMatcherWorkerRequest(
  value: unknown,
  maxBatchChars: number
): CustomMatcherWorkerRequest {
  if (!isRecord(value) || value.protocolVersion !== CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION) {
    throw new Error("Invalid custom matcher worker request.");
  }
  const id = parseWorkerRequestId(value.id);
  if (value.type === "finish") {
    return {
      protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
      id,
      type: "finish"
    };
  }
  const chunk = parseWorkerRequestChunk(value, maxBatchChars);
  return {
    protocolVersion: CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION,
    id,
    type: "acceptChunk",
    chunk
  };
}

function parseWorkerRequestId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid custom matcher worker request.");
  }
  return value;
}

function parseWorkerRequestChunk(value: Record<string, unknown>, maxBatchChars: number): string {
  if (value.type !== "acceptChunk" || typeof value.chunk !== "string") {
    throw new Error("Invalid or oversized custom matcher worker chunk.");
  }
  if (value.chunk.length > maxBatchChars) {
    throw new Error("Invalid or oversized custom matcher worker chunk.");
  }
  return value.chunk;
}

export function isCustomMatcherWorkerResponse(
  value: unknown
): value is CustomMatcherWorkerResponse {
  if (
    !isRecord(value) ||
    value.protocolVersion !== CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  if (!value.ok) {
    return typeof value.error === "string";
  }
  return Array.isArray(value.diagnostics) && value.diagnostics.every(isRawBuildDiagnostic);
}

function deserializeMatchers(value: unknown): NormalizedCustomDiagnosticMatcher[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_MATCHERS) {
    throw new Error(`Custom matchers must be an array of at most ${MAX_CUSTOM_MATCHERS} entries.`);
  }
  const ids = new Set<string>();
  return value.map((matcher) => deserializeMatcher(matcher, ids));
}

function deserializeMatcher(value: unknown, ids: Set<string>): NormalizedCustomDiagnosticMatcher {
  if (!isRecord(value)) {
    throw new Error("Custom matcher entries must be objects.");
  }
  const id = registerMatcherId(value.id, ids);
  assertOptionalBoundedString(value.source, "Custom matcher source");
  const severity = parseMatcherSeverity(value.severity, id);
  const base = parseMatcherBase(value.base, id);
  const patterns = deserializeMatcherPatterns(value.patterns, id, typeof base !== "undefined");
  return {
    id,
    source: value.source as string | undefined,
    severity,
    base,
    patterns
  };
}

function registerMatcherId(value: unknown, ids: Set<string>): string {
  assertBoundedString(value, "Custom matcher id");
  if (ids.has(value)) {
    throw new Error(`Duplicate custom matcher id '${value}'.`);
  }
  ids.add(value);
  return value;
}

function parseMatcherSeverity(value: unknown, id: string): BuildDiagnosticSeverity | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!isSeverity(value)) {
    throw new Error(`Invalid severity for custom matcher '${id}'.`);
  }
  return value;
}

function parseMatcherBase(value: unknown, id: string): NormalizedCustomDiagnosticMatcher["base"] {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!BUILT_IN_IDS.has(String(value))) {
    throw new Error(`Invalid base parser for custom matcher '${id}'.`);
  }
  return value as NormalizedCustomDiagnosticMatcher["base"];
}

function deserializeMatcherPatterns(
  value: unknown,
  id: string,
  hasBase: boolean
): NormalizedCustomDiagnosticPattern[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_MATCHER_PATTERNS) {
    throw new Error(
      `Custom matcher '${id}' exceeds the ${MAX_CUSTOM_MATCHER_PATTERNS} pattern limit.`
    );
  }
  const patterns = value.map((pattern, index) =>
    deserializePattern(pattern, index === value.length - 1)
  );
  if (patterns.length === 0 && !hasBase) {
    throw new Error(`Custom matcher '${id}' requires patterns or a base parser.`);
  }
  return patterns;
}

function deserializePattern(value: unknown, isFinal: boolean): NormalizedCustomDiagnosticPattern {
  if (!isRecord(value)) {
    throw new Error("Custom matcher patterns must be objects.");
  }
  const { regexpSource, regexp } = deserializePatternRegexp(value.regexpSource);
  const kind = deserializePatternKind(value.kind);
  assertPatternCaptures(value);
  const loop = deserializePatternLoop(value.loop, isFinal);
  return createNormalizedCustomDiagnosticPattern(value, regexpSource, regexp, kind, loop);
}

function deserializePatternRegexp(value: unknown): { regexpSource: string; regexp: RegExp } {
  if (typeof value !== "string") {
    throw new Error("Custom matcher pattern is missing regexpSource.");
  }
  const validation = validateCustomMatcherPatternRegexp(value);
  if (!validation.safe || !validation.regexp) {
    throw new Error(validation.reason ?? "Invalid custom matcher regular expression.");
  }
  return { regexpSource: value, regexp: validation.regexp };
}

function deserializePatternKind(value: unknown): CustomDiagnosticPatternKind {
  if (!isCustomMatcherPatternKind(value)) {
    throw new Error("Custom matcher pattern kind must be 'file' or 'location'.");
  }
  return value;
}

function assertPatternCaptures(value: Record<string, unknown>): void {
  for (const property of CUSTOM_MATCHER_CAPTURE_PROPERTIES) {
    const capture = value[property];
    if (typeof capture !== "undefined" && !isCustomMatcherCaptureIndex(capture)) {
      throw new Error(`Invalid custom matcher capture index '${property}'.`);
    }
  }
}

function deserializePatternLoop(value: unknown, isFinal: boolean): boolean | undefined {
  if (!isCustomMatcherLoop(value)) {
    throw new Error("Custom matcher loop must be a boolean.");
  }
  if (!isCustomMatcherLoopAllowed(value, isFinal)) {
    throw new Error("Only the final custom matcher pattern may loop.");
  }
  return value;
}

function isRawBuildDiagnostic(value: unknown): value is RawBuildDiagnostic {
  if (!isRecord(value)) {
    return false;
  }
  const requiredStrings = ["parserId", "source", "message", "rawPath", "rawText"] as const;
  const requiredNumbers = ["line", "priority", "logLine", "sequence"] as const;
  return (
    requiredStrings.every((property) => typeof value[property] === "string") &&
    requiredNumbers.every(
      (property) => typeof value[property] === "number" && Number.isFinite(value[property])
    ) &&
    isSeverity(value.severity) &&
    (value.kind === "problem" || value.kind === "stack-frame")
  );
}

function isSeverity(value: unknown): value is BuildDiagnosticSeverity {
  return value === "error" || value === "warning" || value === "information";
}

function assertBoundedString(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_CUSTOM_MATCHER_METADATA_LENGTH
  ) {
    throw new Error(
      `${label} must be a non-empty string of at most ${MAX_CUSTOM_MATCHER_METADATA_LENGTH} characters.`
    );
  }
}

function assertOptionalBoundedString(value: unknown, label: string): void {
  if (typeof value !== "undefined") {
    assertBoundedString(value, label);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
