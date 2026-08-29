import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import {
  type CustomCaptureState,
  capturesFromPattern,
  customDraft,
  type DiagnosticDraft,
  fileUrlToPath,
  looksLikeStandaloneSourcePath,
  mergeCaptures,
  type NormalizedLogLine,
  normalizeBuildLogLine,
  parseGccClang,
  parseGeneric,
  parseGo,
  parseMsvc,
  parseTypeScript,
  positiveInteger,
  type StackState,
  severityFromText,
  stackDraft
} from "./BuildDiagnosticParserSupport";
import { BROAD_CORE_DIAGNOSTIC_PARSERS } from "./BuildDiagnosticProfiles";
import type {
  BuiltInDiagnosticParserId,
  NormalizedCustomDiagnosticMatcher,
  RawBuildDiagnostic
} from "./BuildDiagnosticTypes";

interface CustomMatcherState {
  patternIndex: number;
  captures: CustomCaptureState;
}

export interface BuildDiagnosticLogParserOptions {
  builtIns?: readonly BuiltInDiagnosticParserId[];
  customMatchers?: readonly NormalizedCustomDiagnosticMatcher[];
  maxDiagnosticsPerCall?: number;
  maxLineChars?: number;
}

export const MAX_DIAGNOSTIC_LOG_LINE_CHARS = 1024 * 1024;

/**
 * Stateful line parser suitable for Jenkins progressive-console chunks. It
 * retains only an incomplete line and the small amount of multiline matcher
 * state required between calls.
 */
export class BuildDiagnosticLogParser {
  private readonly enabledBuiltIns: ReadonlySet<BuiltInDiagnosticParserId>;
  private readonly customMatchers: readonly NormalizedCustomDiagnosticMatcher[];
  private readonly maxDiagnosticsPerCall: number;
  private readonly maxLineChars: number;
  private readonly customStates = new Map<string, CustomMatcherState>();
  private remainderParts: string[] = [];
  private remainderLength = 0;
  private discardingOversizedLine = false;
  private lineTruncated = false;
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
    this.maxLineChars =
      typeof options.maxLineChars === "number" && Number.isFinite(options.maxLineChars)
        ? Math.max(1, Math.floor(options.maxLineChars))
        : MAX_DIAGNOSTIC_LOG_LINE_CHARS;
    for (const matcher of this.customMatchers) {
      if (matcher.base) {
        enabled.add(matcher.base);
      }
      this.customStates.set(matcher.id, { patternIndex: 0, captures: {} });
    }
    this.enabledBuiltIns = enabled;
  }

  get didTruncateLine(): boolean {
    return this.lineTruncated;
  }

  acceptChunk(chunk: string): RawBuildDiagnostic[] {
    if (!chunk) {
      return [];
    }
    const diagnostics: RawBuildDiagnostic[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.discardingOversizedLine) {
        const newline = chunk.indexOf("\n", offset);
        if (newline < 0) {
          return diagnostics;
        }
        this.discardingOversizedLine = false;
        this.lineNumber += 1;
        offset = newline + 1;
        continue;
      }

      const newline = chunk.indexOf("\n", offset);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.slice(offset, end);
      if (this.remainderLength + segment.length > this.maxLineChars) {
        this.clearRemainder();
        this.lineTruncated = true;
        if (newline < 0) {
          this.discardingOversizedLine = true;
          return diagnostics;
        }
        this.lineNumber += 1;
        offset = newline + 1;
        continue;
      }
      if (newline < 0) {
        this.appendRemainder(segment);
        return diagnostics;
      }

      let line = this.consumeRemainder(segment);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      this.appendDiagnostics(diagnostics, this.parseLine(line));
      offset = newline + 1;
    }
    return diagnostics;
  }

  finish(): RawBuildDiagnostic[] {
    if (this.discardingOversizedLine) {
      this.discardingOversizedLine = false;
      this.lineNumber += 1;
      return [];
    }
    if (this.remainderLength === 0) {
      return [];
    }
    let line = this.consumeRemainder("");
    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }
    const diagnostics: RawBuildDiagnostic[] = [];
    this.appendDiagnostics(diagnostics, this.parseLine(line));
    return diagnostics;
  }

  private appendRemainder(segment: string): void {
    if (segment) {
      this.remainderParts.push(segment);
      this.remainderLength += segment.length;
    }
  }

  private consumeRemainder(segment: string): string {
    const line = this.remainderLength === 0 ? segment : [...this.remainderParts, segment].join("");
    this.clearRemainder();
    return line;
  }

  private clearRemainder(): void {
    this.remainderParts = [];
    this.remainderLength = 0;
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
    if (this.enabledBuiltIns.has("typescript")) {
      const result = parseTypeScript(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("msvc")) {
      const result = parseMsvc(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("gcc-clang")) {
      const result = parseGccClang(text, line.prefixSeverity);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("eslint")) {
      const result = this.parseEslint(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("rust")) {
      const result = this.parseRust(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("go")) {
      const result = parseGo(text, line.prefixSeverity);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("jvm-stack")) {
      const result = this.parseJvmStack(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("javascript-stack")) {
      const result = this.parseJavaScriptStack(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("python-traceback")) {
      const result = this.parsePythonStack(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("dotnet-stack")) {
      const result = this.parseDotnetStack(text);
      if (result) {
        return result;
      }
    }
    if (this.enabledBuiltIns.has("generic")) {
      const result = parseGeneric(text, line.prefixSeverity);
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

export { normalizeBuildLogLine } from "./BuildDiagnosticParserSupport";
