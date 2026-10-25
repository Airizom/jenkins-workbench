import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import { isPlainRecord } from "../shared/runtimeGuards";
import type {
  CustomDiagnosticPatternKind,
  NormalizedCustomDiagnosticMatcher,
  NormalizedCustomDiagnosticPattern,
  RawBuildDiagnostic
} from "./BuildDiagnosticTypes";

export const CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION = 2;
export const MAX_CUSTOM_MATCHERS = 64;
export const MAX_CUSTOM_MATCHER_PATTERNS = 16;
export const MAX_CUSTOM_MATCHER_BATCH_CHARS = 1024 * 1024;
export const MAX_CUSTOM_MATCHER_DIAGNOSTICS_PER_BATCH = 10_000;
export const MAX_CUSTOM_MATCHER_METADATA_LENGTH = 256;
export const MAX_CUSTOM_MATCHER_ERROR_MESSAGE_LENGTH = 512;

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
      lineTruncated: boolean;
    }
  | {
      protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
      id: number;
      ok: false;
      error: string;
    };

/** Posted once by the worker after its module and matchers finish initializing. */
export interface CustomMatcherWorkerReadyMessage {
  protocolVersion: typeof CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION;
  type: "ready";
}

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
    patterns: matcher.patterns.map(({ regexp: _regexp, ...pattern }) => pattern)
  }));
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

export function createNormalizedCustomDiagnosticPattern(
  value: Record<string, unknown>,
  regexpSource: string,
  regexp: RegExp,
  kind: CustomDiagnosticPatternKind,
  loop: boolean | undefined
): NormalizedCustomDiagnosticPattern {
  const pattern: NormalizedCustomDiagnosticPattern = { regexpSource, regexp, kind, loop };
  for (const property of CUSTOM_MATCHER_CAPTURE_PROPERTIES) {
    pattern[property] = value[property] as number | undefined;
  }
  return pattern;
}

export function parseCustomMatcherWorkerData(value: unknown): ParsedCustomMatcherWorkerData {
  if (!isPlainRecord(value)) {
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
    matchers: hydrateCustomDiagnosticMatchers(
      value.matchers as SerializedCustomDiagnosticMatcher[]
    ),
    maxBatchChars: value.maxBatchChars
  };
}

function hydrateCustomDiagnosticMatchers(
  matchers: readonly SerializedCustomDiagnosticMatcher[]
): NormalizedCustomDiagnosticMatcher[] {
  return matchers.map((matcher) => ({
    ...matcher,
    patterns: matcher.patterns.map((pattern) => ({
      ...pattern,
      regexp: new RegExp(pattern.regexpSource)
    }))
  }));
}

export function parseCustomMatcherWorkerRequest(
  value: unknown,
  maxBatchChars: number
): CustomMatcherWorkerRequest {
  if (!isPlainRecord(value) || value.protocolVersion !== CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION) {
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
  if (!isWorkerRequestId(value)) {
    throw new Error("Invalid custom matcher worker request.");
  }
  return value;
}

/** Request IDs are positive safe integers on both sides of the worker boundary. */
export function isWorkerRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
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

export function isCustomMatcherWorkerReadyMessage(
  value: unknown
): value is CustomMatcherWorkerReadyMessage {
  return (
    isPlainRecord(value) &&
    value.protocolVersion === CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION &&
    value.type === "ready"
  );
}

export function isCustomMatcherWorkerResponse(
  value: unknown
): value is CustomMatcherWorkerResponse {
  if (
    !isPlainRecord(value) ||
    value.protocolVersion !== CUSTOM_MATCHER_WORKER_PROTOCOL_VERSION ||
    !isWorkerRequestId(value.id) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  if (!value.ok) {
    return typeof value.error === "string";
  }
  return (
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isRawBuildDiagnostic) &&
    typeof value.lineTruncated === "boolean"
  );
}

function isRawBuildDiagnostic(value: unknown): value is RawBuildDiagnostic {
  if (!isPlainRecord(value)) {
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

/** Bounded error text shared by both sides of the worker boundary. */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.slice(0, MAX_CUSTOM_MATCHER_ERROR_MESSAGE_LENGTH) || "Custom matcher worker failed."
  );
}

function isSeverity(value: unknown): value is BuildDiagnosticSeverity {
  return value === "error" || value === "warning" || value === "information";
}
