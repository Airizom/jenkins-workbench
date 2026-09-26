import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import { stripConsoleControlSequences } from "./BuildDiagnosticConsoleText";
import type {
  BuildDiagnosticKind,
  BuiltInDiagnosticParserId,
  NormalizedCustomDiagnosticMatcher,
  NormalizedCustomDiagnosticPattern
} from "./BuildDiagnosticTypes";

export interface DiagnosticDraft {
  parserId: string;
  source: string;
  severity: BuildDiagnosticSeverity;
  message: string;
  rawPath: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  code?: string;
  kind?: BuildDiagnosticKind;
  priority: number;
  stackTraceId?: string;
  stackFrameIndex?: number;
}

export interface NormalizedLogLine {
  text: string;
  prefixSeverity?: BuildDiagnosticSeverity;
}

export interface StackState {
  id: string;
  message: string;
  nextFrame: number;
}

export interface CustomCaptureState {
  rawPath?: string;
  location?: string;
  line?: string;
  column?: string;
  endLine?: string;
  endColumn?: string;
  severity?: string;
  code?: string;
  message?: string;
}

export function normalizeBuildLogLine(rawLine: string): NormalizedLogLine {
  let text = stripConsoleControlSequences(rawLine);
  let prefixSeverity: BuildDiagnosticSeverity | undefined;
  let previous = "";
  while (previous !== text) {
    previous = text;
    text = text.replace(/^\s*\[(?:\d{4}-\d{2}-\d{2}[T ][^\]]+|Pipeline(?:\s+[^\]]*)?)\]\s*/i, "");
    text = text.replace(/^\s*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s+/, "");
    const severityPrefix = text.match(/^\s*\[(ERROR|WARN(?:ING)?|INFO)\]\s*/i);
    if (severityPrefix) {
      prefixSeverity = severityFromText(severityPrefix[1]);
      text = text.slice(severityPrefix[0].length);
      continue;
    }
    text = text.replace(/^\s*\[(?:javac|maven|gradle|cargo|eslint|pytest)\]\s*/i, "");
  }
  return { text, prefixSeverity };
}

export function parseTypeScript(text: string): DiagnosticDraft | undefined {
  const parenthesized = text.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+TS(\d+):\s*(.+)$/i);
  const colon = text.match(/^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+TS(\d+):\s*(.+)$/i);
  const match = parenthesized ?? colon;
  if (!match) {
    return undefined;
  }
  return {
    parserId: "typescript",
    source: "typescript",
    severity: severityFromText(match[4]),
    message: match[6].trim(),
    rawPath: match[1].trim(),
    line: positiveInteger(match[2]),
    column: positiveInteger(match[3]),
    code: `TS${match[5]}`,
    priority: 100
  };
}

export function parseMsvc(text: string): DiagnosticDraft | undefined {
  const match = text.match(
    /^(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)\s+([A-Za-z]+\d+)\s*:\s*(.+)$/i
  );
  if (!match) {
    return undefined;
  }
  return {
    parserId: "msvc",
    source: "msvc",
    severity: severityFromText(match[4]),
    message: match[6].trim(),
    rawPath: match[1].trim(),
    line: positiveInteger(match[2]),
    column: optionalPositiveInteger(match[3]),
    code: match[5],
    priority: 110
  };
}

export function parseGccClang(
  text: string,
  prefixSeverity?: BuildDiagnosticSeverity
): DiagnosticDraft | undefined {
  const bracketed = text.match(/^(.+?):\[(\d+),(\d+)\]\s*(?:(error|warning)\s*:\s*)?(.+)$/i);
  if (bracketed) {
    return {
      parserId: "gcc-clang",
      source: "compiler",
      severity: bracketed[4] ? severityFromText(bracketed[4]) : (prefixSeverity ?? "error"),
      message: bracketed[5].trim(),
      rawPath: bracketed[1].trim(),
      line: positiveInteger(bracketed[2]),
      column: positiveInteger(bracketed[3]),
      priority: 120
    };
  }
  const match = text.match(
    /^(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note|info(?:rmation)?)\s*:\s*(.+?)(?:\s+\[([^\]]+)\])?\s*$/i
  );
  if (!match) {
    return undefined;
  }
  return {
    parserId: "gcc-clang",
    source: "compiler",
    severity: severityFromText(match[4]),
    message: match[5].trim(),
    rawPath: match[1].trim(),
    line: positiveInteger(match[2]),
    column: optionalPositiveInteger(match[3]),
    code: match[6],
    priority: 120
  };
}

export function parseGo(
  text: string,
  prefixSeverity?: BuildDiagnosticSeverity
): DiagnosticDraft | undefined {
  const match = text.match(/^(.+?\.go):(\d+)(?::(\d+))?:\s*(.+)$/i);
  if (!match) {
    return undefined;
  }
  return {
    parserId: "go",
    source: "go",
    severity: prefixSeverity ?? "error",
    message: match[4].trim(),
    rawPath: match[1].trim(),
    line: positiveInteger(match[2]),
    column: optionalPositiveInteger(match[3]),
    priority: 150
  };
}

export function parseGeneric(
  text: string,
  prefixSeverity?: BuildDiagnosticSeverity
): DiagnosticDraft | undefined {
  const explicit = text.match(
    /^(.+?):(\d+)(?::(\d+))?\s*[:-]\s*(error|warning|warn|info(?:rmation)?)\b\s*:?\s*(.+)$/i
  );
  if (explicit && looksLikeSourcePath(explicit[1])) {
    return {
      parserId: "generic",
      source: "build",
      severity: severityFromText(explicit[4]),
      message: explicit[5].trim(),
      rawPath: explicit[1].trim(),
      line: positiveInteger(explicit[2]),
      column: optionalPositiveInteger(explicit[3]),
      priority: 900
    };
  }

  const prefixed = text.match(/^(.+?):(\d+)(?::(\d+))?:\s*(.+)$/);
  if (prefixed && prefixSeverity && looksLikeSourcePath(prefixed[1])) {
    return {
      parserId: "generic",
      source: "build",
      severity: prefixSeverity,
      message: prefixed[4].trim(),
      rawPath: prefixed[1].trim(),
      line: positiveInteger(prefixed[2]),
      column: optionalPositiveInteger(prefixed[3]),
      priority: 910
    };
  }
  return undefined;
}

export function stackDraft(
  parserId: BuiltInDiagnosticParserId,
  source: string,
  rawPath: string,
  line: string,
  column: string | undefined,
  stack: StackState,
  priority: number
): DiagnosticDraft {
  const frameIndex = stack.nextFrame;
  stack.nextFrame += 1;
  return {
    parserId,
    source,
    severity: "error",
    message: stack.message,
    rawPath: rawPath.trim(),
    line: positiveInteger(line),
    column: optionalPositiveInteger(column),
    kind: "stack-frame",
    stackTraceId: stack.id,
    stackFrameIndex: frameIndex,
    priority
  };
}

export function capturesFromPattern(
  pattern: NormalizedCustomDiagnosticPattern,
  match: RegExpExecArray
): CustomCaptureState {
  return {
    rawPath: captured(match, pattern.file),
    location: captured(match, pattern.location),
    line: captured(match, pattern.line),
    column: captured(match, pattern.column),
    endLine: captured(match, pattern.endLine),
    endColumn: captured(match, pattern.endColumn),
    severity: captured(match, pattern.severity),
    code: captured(match, pattern.code),
    message: captured(match, pattern.message)
  };
}

export function mergeCaptures(
  earlier: CustomCaptureState,
  later: CustomCaptureState
): CustomCaptureState {
  const result = { ...earlier };
  for (const [key, value] of Object.entries(later) as [
    keyof CustomCaptureState,
    string | undefined
  ][]) {
    if (typeof value !== "undefined") {
      result[key] = value;
    }
  }
  return result;
}

export function customDraft(
  matcher: NormalizedCustomDiagnosticMatcher,
  pattern: NormalizedCustomDiagnosticPattern,
  captures: CustomCaptureState,
  lineText: string
): DiagnosticDraft | undefined {
  if (!captures.rawPath) {
    return undefined;
  }
  const location = parseLocation(captures.location);
  const position = resolveCustomDiagnosticPosition(pattern.kind, captures, location);
  return {
    parserId: `custom:${matcher.id}`,
    source: matcher.source ?? matcher.id,
    severity: capturedSeverity(captures.severity) ?? matcher.severity ?? "error",
    message: normalizeOptionalText(captures.message) ?? lineText.trim(),
    rawPath: captures.rawPath.trim(),
    ...position,
    code: normalizeOptionalText(captures.code),
    priority: 10
  };
}

function resolveCustomDiagnosticPosition(
  kind: NormalizedCustomDiagnosticPattern["kind"],
  captures: CustomCaptureState,
  location: ReturnType<typeof parseLocation>
): Pick<DiagnosticDraft, "line" | "column" | "endLine" | "endColumn"> {
  if (kind === "file") {
    return { line: 1, column: 1 };
  }
  return {
    line: positiveInteger(captures.line ?? location.line ?? "1"),
    column: optionalPositiveInteger(captures.column ?? location.column),
    endLine: optionalPositiveInteger(captures.endLine ?? location.endLine),
    endColumn: optionalPositiveInteger(captures.endColumn ?? location.endColumn)
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function parseLocation(value: string | undefined): {
  line?: string;
  column?: string;
  endLine?: string;
  endColumn?: string;
} {
  if (!value) {
    return {};
  }
  const parts = value.split(/\s*[, :]\s*/).filter(Boolean);
  return {
    line: parts[0],
    column: parts[1],
    endLine: parts[2],
    endColumn: parts[3]
  };
}

function captured(match: RegExpExecArray, index: number | undefined): string | undefined {
  if (typeof index === "undefined") {
    return undefined;
  }
  const value = match[index];
  return value ? value : undefined;
}

function capturedSeverity(value: string | undefined): BuildDiagnosticSeverity | undefined {
  if (!value) {
    return undefined;
  }
  if (/^(?:error|fatal)$/i.test(value)) {
    return "error";
  }
  if (/^(?:warning|warn)$/i.test(value)) {
    return "warning";
  }
  if (/^(?:info|information|note)$/i.test(value)) {
    return "information";
  }
  return undefined;
}

export function severityFromText(value: string): BuildDiagnosticSeverity {
  return capturedSeverity(value) ?? "error";
}

export function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  return typeof value === "undefined" ? undefined : positiveInteger(value);
}

export function looksLikeStandaloneSourcePath(value: string): boolean {
  const text = value.trim();
  return (
    looksLikeSourcePath(text) &&
    (/^(?:\/|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(text) || !/\s/.test(text))
  );
}

function looksLikeSourcePath(value: string): boolean {
  return /(?:^|[\\/])[^\\/]+\.[A-Za-z0-9_+-]{1,12}$/.test(value.trim());
}

export function fileUrlToPath(value: string): string {
  if (!value.toLowerCase().startsWith("file://")) {
    return value;
  }
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return value.replace(/^file:\/\//i, "");
  }
}
