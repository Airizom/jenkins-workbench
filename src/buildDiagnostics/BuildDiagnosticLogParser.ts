import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import { stripConsoleControlSequences } from "./BuildDiagnosticConsoleText";
import { BROAD_CORE_DIAGNOSTIC_PARSERS } from "./BuildDiagnosticProfiles";
import type {
  BuildDiagnosticKind,
  BuiltInDiagnosticParserId,
  NormalizedCustomDiagnosticMatcher,
  NormalizedCustomDiagnosticPattern,
  RawBuildDiagnostic
} from "./BuildDiagnosticTypes";

interface DiagnosticDraft {
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

interface NormalizedLogLine {
  text: string;
  prefixSeverity?: BuildDiagnosticSeverity;
}

interface StackState {
  id: string;
  message: string;
  nextFrame: number;
}

interface CustomCaptureState {
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

interface CustomMatcherState {
  patternIndex: number;
  captures: CustomCaptureState;
}

export interface BuildDiagnosticLogParserOptions {
  builtIns?: readonly BuiltInDiagnosticParserId[];
  customMatchers?: readonly NormalizedCustomDiagnosticMatcher[];
  maxDiagnosticsPerCall?: number;
}

/**
 * Stateful line parser suitable for Jenkins progressive-console chunks. It
 * retains only an incomplete line and the small amount of multiline matcher
 * state required between calls.
 */
export class BuildDiagnosticLogParser {
  private readonly enabledBuiltIns: ReadonlySet<BuiltInDiagnosticParserId>;
  private readonly customMatchers: readonly NormalizedCustomDiagnosticMatcher[];
  private readonly maxDiagnosticsPerCall: number;
  private readonly customStates = new Map<string, CustomMatcherState>();
  private remainder = "";
  private lineNumber = 0;
  private sequence = 0;
  private stackCounter = 0;
  private eslintPath: string | undefined;
  private rustHeader:
    | { severity: BuildDiagnosticSeverity; code?: string; message: string }
    | undefined;
  private jvmStack: StackState | undefined;
  private javascriptStack: StackState | undefined;
  private pythonStack: StackState | undefined;
  private dotnetStack: StackState | undefined;

  constructor(options: BuildDiagnosticLogParserOptions = {}) {
    const enabled = new Set(options.builtIns ?? BROAD_CORE_DIAGNOSTIC_PARSERS);
    this.customMatchers = options.customMatchers ?? [];
    this.maxDiagnosticsPerCall =
      typeof options.maxDiagnosticsPerCall === "number" &&
      Number.isFinite(options.maxDiagnosticsPerCall)
        ? Math.max(1, Math.floor(options.maxDiagnosticsPerCall))
        : Number.POSITIVE_INFINITY;
    for (const matcher of this.customMatchers) {
      if (matcher.base) {
        enabled.add(matcher.base);
      }
      this.customStates.set(matcher.id, { patternIndex: 0, captures: {} });
    }
    this.enabledBuiltIns = enabled;
  }

  acceptChunk(chunk: string): RawBuildDiagnostic[] {
    if (!chunk) {
      return [];
    }
    const input = this.remainder + chunk;
    const diagnostics: RawBuildDiagnostic[] = [];
    let offset = 0;
    for (;;) {
      const newline = input.indexOf("\n", offset);
      if (newline < 0) {
        break;
      }
      let line = input.slice(offset, newline);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      this.appendDiagnostics(diagnostics, this.parseLine(line));
      offset = newline + 1;
    }
    this.remainder = input.slice(offset);
    return diagnostics;
  }

  finish(): RawBuildDiagnostic[] {
    if (!this.remainder) {
      return [];
    }
    let line = this.remainder;
    this.remainder = "";
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    const diagnostics: RawBuildDiagnostic[] = [];
    this.appendDiagnostics(diagnostics, this.parseLine(line));
    return diagnostics;
  }

  private appendDiagnostics(
    target: RawBuildDiagnostic[],
    next: readonly RawBuildDiagnostic[]
  ): void {
    if (target.length + next.length > this.maxDiagnosticsPerCall) {
      throw new Error(
        `Diagnostic parser exceeded ${this.maxDiagnosticsPerCall} results in one call.`
      );
    }
    target.push(...next);
  }

  private parseLine(rawLine: string): RawBuildDiagnostic[] {
    this.lineNumber += 1;
    const normalized = normalizeBuildLogLine(rawLine);
    const diagnostics: RawBuildDiagnostic[] = [];

    for (const matcher of this.customMatchers) {
      diagnostics.push(...this.parseCustomMatcher(matcher, normalized.text, rawLine));
    }

    const builtIn = this.parseBuiltIn(normalized);
    if (builtIn) {
      diagnostics.push(this.materialize(this.applyBaseMatcher(builtIn), rawLine));
    }
    return diagnostics;
  }

  private parseBuiltIn(line: NormalizedLogLine): DiagnosticDraft | undefined {
    const text = line.text;
    const attempts: Array<[BuiltInDiagnosticParserId, () => DiagnosticDraft | undefined]> = [
      ["typescript", () => parseTypeScript(text)],
      ["msvc", () => parseMsvc(text)],
      ["gcc-clang", () => parseGccClang(text, line.prefixSeverity)],
      ["eslint", () => this.parseEslint(text)],
      ["rust", () => this.parseRust(text)],
      ["go", () => parseGo(text, line.prefixSeverity)],
      ["jvm-stack", () => this.parseJvmStack(text)],
      ["javascript-stack", () => this.parseJavaScriptStack(text)],
      ["python-traceback", () => this.parsePythonStack(text)],
      ["dotnet-stack", () => this.parseDotnetStack(text)],
      ["generic", () => parseGeneric(text, line.prefixSeverity)]
    ];
    for (const [parserId, parse] of attempts) {
      if (!this.enabledBuiltIns.has(parserId)) {
        continue;
      }
      const result = parse();
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  private parseEslint(text: string): DiagnosticDraft | undefined {
    const finding = text.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([^\s]+))?\s*$/i);
    if (finding && this.eslintPath) {
      return {
        parserId: "eslint",
        source: "eslint",
        severity: severityFromText(finding[3]),
        message: finding[4].trim(),
        rawPath: this.eslintPath,
        line: positiveInteger(finding[1]),
        column: positiveInteger(finding[2]),
        code: finding[5],
        priority: 130
      };
    }
    if (looksLikeStandaloneSourcePath(text)) {
      this.eslintPath = text.trim();
    } else if (!text.trim()) {
      this.eslintPath = undefined;
    }
    return undefined;
  }

  private parseRust(text: string): DiagnosticDraft | undefined {
    const header = text.match(/^\s*(error|warning)(?:\[([^\]]+)\])?:\s*(.+)$/i);
    if (header) {
      this.rustHeader = {
        severity: severityFromText(header[1]),
        code: header[2],
        message: header[3].trim()
      };
      return undefined;
    }
    const span = text.match(/^\s*-->\s+(.+?):(\d+):(\d+)\s*$/);
    if (!span || !this.rustHeader) {
      return undefined;
    }
    const result: DiagnosticDraft = {
      parserId: "rust",
      source: "rustc",
      severity: this.rustHeader.severity,
      message: this.rustHeader.message,
      rawPath: span[1].trim(),
      line: positiveInteger(span[2]),
      column: positiveInteger(span[3]),
      code: this.rustHeader.code,
      priority: 140
    };
    this.rustHeader = undefined;
    return result;
  }

  private parseJvmStack(text: string): DiagnosticDraft | undefined {
    if (
      /^(?:Exception in thread\s+"[^"]+"\s+)?(?:Caused by:\s*)?[\w.$]+(?:Exception|Error)(?::\s*.*)?$/.test(
        text.trim()
      )
    ) {
      this.jvmStack = this.newStack(text.trim());
      return undefined;
    }
    const frame = text.match(/^\s*at\s+[^()]+\(([^():]+\.java):(\d+)\)\s*$/);
    if (!frame) {
      return undefined;
    }
    this.jvmStack ??= this.newStack("Java stack frame");
    const stack = this.jvmStack;
    return stackDraft("jvm-stack", "java", frame[1], frame[2], undefined, stack, 210);
  }

  private parseJavaScriptStack(text: string): DiagnosticDraft | undefined {
    if (
      /^(?:[A-Za-z]*Error|TypeError|RangeError|ReferenceError|SyntaxError):(?:\s*.*)?$/.test(
        text.trim()
      )
    ) {
      this.javascriptStack = this.newStack(text.trim());
      return undefined;
    }
    const frame = text.match(
      /^\s*at\s+(?:(?:async\s+)?[^()]+\s+\()?((?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/|\.{0,2}[\\/])?[^()\s]+?\.(?:[cm]?js|jsx|ts|tsx)):(\d+):(\d+)\)?\s*$/i
    );
    if (!frame) {
      return undefined;
    }
    this.javascriptStack ??= this.newStack("JavaScript stack frame");
    const stack = this.javascriptStack;
    return stackDraft(
      "javascript-stack",
      "javascript",
      fileUrlToPath(frame[1]),
      frame[2],
      frame[3],
      stack,
      220
    );
  }

  private parsePythonStack(text: string): DiagnosticDraft | undefined {
    if (/^Traceback \(most recent call last\):\s*$/.test(text.trim())) {
      this.pythonStack = this.newStack("Python traceback");
      return undefined;
    }
    const frame = text.match(/^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?\s*$/);
    if (!frame) {
      return undefined;
    }
    this.pythonStack ??= this.newStack("Python traceback");
    const stack = this.pythonStack;
    const message = frame[3] ? `${stack.message}: ${frame[3].trim()}` : stack.message;
    return {
      ...stackDraft("python-traceback", "python", frame[1], frame[2], undefined, stack, 230),
      message
    };
  }

  private parseDotnetStack(text: string): DiagnosticDraft | undefined {
    if (
      /^(?:Unhandled exception\.\s+)?(?:--->\s+)?System\.[\w.]+Exception(?::\s*.*)?$/.test(
        text.trim()
      )
    ) {
      this.dotnetStack = this.newStack(text.trim());
      return undefined;
    }
    const frame = text.match(/^\s*at\s+.+?\s+in\s+(.+?):line\s+(\d+)\s*$/i);
    if (!frame) {
      return undefined;
    }
    this.dotnetStack ??= this.newStack(".NET stack frame");
    const stack = this.dotnetStack;
    return stackDraft("dotnet-stack", "dotnet", frame[1], frame[2], undefined, stack, 240);
  }

  private newStack(message: string): StackState {
    this.stackCounter += 1;
    return { id: `stack-${this.stackCounter}`, message, nextFrame: 0 };
  }

  private parseCustomMatcher(
    matcher: NormalizedCustomDiagnosticMatcher,
    line: string,
    rawLine: string
  ): RawBuildDiagnostic[] {
    if (matcher.patterns.length === 0) {
      return [];
    }
    const state = this.customStates.get(matcher.id) ?? { patternIndex: 0, captures: {} };
    this.customStates.set(matcher.id, state);
    const result = this.tryCustomPattern(matcher, state, line, rawLine);
    if (result.matched || state.patternIndex === 0) {
      return result.diagnostic ? [result.diagnostic] : [];
    }

    state.patternIndex = 0;
    state.captures = {};
    const retry = this.tryCustomPattern(matcher, state, line, rawLine);
    return retry.diagnostic ? [retry.diagnostic] : [];
  }

  private applyBaseMatcher(draft: DiagnosticDraft): DiagnosticDraft {
    const matcher = this.customMatchers.find(
      (candidate) => candidate.base === draft.parserId && candidate.patterns.length === 0
    );
    if (!matcher) {
      return draft;
    }
    return {
      ...draft,
      parserId: `custom:${matcher.id}`,
      source: matcher.source ?? draft.source,
      severity: matcher.severity ?? draft.severity
    };
  }

  private tryCustomPattern(
    matcher: NormalizedCustomDiagnosticMatcher,
    state: CustomMatcherState,
    line: string,
    rawLine: string
  ): { matched: boolean; diagnostic?: RawBuildDiagnostic } {
    const pattern = matcher.patterns[state.patternIndex];
    pattern.regexp.lastIndex = 0;
    const match = pattern.regexp.exec(line);
    if (!match) {
      return { matched: false };
    }
    const priorCaptures = state.captures;
    const captures = mergeCaptures(priorCaptures, capturesFromPattern(pattern, match));
    const finalPattern = state.patternIndex === matcher.patterns.length - 1;
    if (!finalPattern) {
      state.patternIndex += 1;
      state.captures = captures;
      return { matched: true };
    }

    const draft = customDraft(matcher, pattern, captures, line);
    if (pattern.loop) {
      state.captures = priorCaptures;
    } else {
      state.patternIndex = 0;
      state.captures = {};
    }
    return {
      matched: true,
      diagnostic: draft ? this.materialize(draft, rawLine) : undefined
    };
  }

  private materialize(draft: DiagnosticDraft, rawText: string): RawBuildDiagnostic {
    this.sequence += 1;
    return {
      ...draft,
      kind: draft.kind ?? "problem",
      logLine: this.lineNumber,
      rawText,
      sequence: this.sequence
    };
  }
}

export function parseBuildLog(
  text: string,
  options: BuildDiagnosticLogParserOptions = {}
): RawBuildDiagnostic[] {
  const parser = new BuildDiagnosticLogParser(options);
  return [...parser.acceptChunk(text), ...parser.finish()];
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

function parseTypeScript(text: string): DiagnosticDraft | undefined {
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

function parseMsvc(text: string): DiagnosticDraft | undefined {
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

function parseGccClang(
  text: string,
  prefixSeverity?: BuildDiagnosticSeverity
): DiagnosticDraft | undefined {
  const bracketed = text.match(/^(.+?):\[(\d+),(\d+)\]\s*(?:(error|warning)\s*:\s*)?(.+)$/i);
  if (bracketed) {
    return {
      parserId: "gcc-clang",
      source: "compiler",
      severity: prefixSeverity ?? severityFromText(bracketed[4] ?? "error"),
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
    severity: prefixSeverity ?? severityFromText(match[4]),
    message: match[5].trim(),
    rawPath: match[1].trim(),
    line: positiveInteger(match[2]),
    column: optionalPositiveInteger(match[3]),
    code: match[6],
    priority: 120
  };
}

function parseGo(
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

function parseGeneric(
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
      severity: prefixSeverity ?? severityFromText(explicit[4]),
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

function stackDraft(
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

function capturesFromPattern(
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

function mergeCaptures(earlier: CustomCaptureState, later: CustomCaptureState): CustomCaptureState {
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

function customDraft(
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
    severity: resolveCustomDiagnosticSeverity(matcher, captures),
    message: resolveCustomDiagnosticMessage(captures.message, lineText),
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

function resolveCustomDiagnosticSeverity(
  matcher: NormalizedCustomDiagnosticMatcher,
  captures: CustomCaptureState
): BuildDiagnosticSeverity {
  return capturedSeverity(captures.severity) ?? matcher.severity ?? "error";
}

function resolveCustomDiagnosticMessage(message: string | undefined, lineText: string): string {
  return normalizeOptionalText(message) ?? lineText.trim();
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

function severityFromText(value: string): BuildDiagnosticSeverity {
  return capturedSeverity(value) ?? "error";
}

function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  return typeof value === "undefined" ? undefined : positiveInteger(value);
}

function looksLikeStandaloneSourcePath(value: string): boolean {
  const text = value.trim();
  return (
    looksLikeSourcePath(text) &&
    (/^(?:\/|\.\.?[\\/]|[A-Za-z]:[\\/])/.test(text) || !/\s/.test(text))
  );
}

function looksLikeSourcePath(value: string): boolean {
  return /(?:^|[\\/])[^\\/]+\.[A-Za-z0-9_+-]{1,12}$/.test(value.trim());
}

function fileUrlToPath(value: string): string {
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
