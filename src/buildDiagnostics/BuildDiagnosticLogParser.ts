import { BuildDiagnosticBuiltInParser } from "./BuildDiagnosticBuiltInParser";
import { BuildDiagnosticCustomMatcherRunner } from "./BuildDiagnosticCustomMatcherRunner";
import { type DiagnosticDraft, normalizeBuildLogLine } from "./BuildDiagnosticParserSupport";
import { BROAD_CORE_DIAGNOSTIC_PARSERS } from "./BuildDiagnosticProfiles";
import type {
  BuiltInDiagnosticParserId,
  NormalizedCustomDiagnosticMatcher,
  RawBuildDiagnostic
} from "./BuildDiagnosticTypes";

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
  private readonly builtIns: BuildDiagnosticBuiltInParser;
  private readonly customMatchers: BuildDiagnosticCustomMatcherRunner;
  private readonly maxDiagnosticsPerCall: number;
  private readonly maxLineChars: number;
  private remainderParts: string[] = [];
  private remainderLength = 0;
  private discardingOversizedLine = false;
  private lineTruncated = false;
  private lineNumber = 0;
  private sequence = 0;

  constructor(options: BuildDiagnosticLogParserOptions = {}) {
    const customMatchers = options.customMatchers ?? [];
    this.maxDiagnosticsPerCall =
      typeof options.maxDiagnosticsPerCall === "number" &&
      Number.isFinite(options.maxDiagnosticsPerCall)
        ? Math.max(1, Math.floor(options.maxDiagnosticsPerCall))
        : Number.POSITIVE_INFINITY;
    this.maxLineChars =
      typeof options.maxLineChars === "number" && Number.isFinite(options.maxLineChars)
        ? Math.max(1, Math.floor(options.maxLineChars))
        : MAX_DIAGNOSTIC_LOG_LINE_CHARS;
    this.customMatchers = new BuildDiagnosticCustomMatcherRunner(customMatchers);
    this.builtIns = new BuildDiagnosticBuiltInParser(
      enabledBuiltInParsers(options.builtIns, customMatchers)
    );
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
    this.builtIns.endTerminatedStacks(normalized.text);

    const diagnostics = this.customMatchers
      .parseLine(normalized.text)
      .map((draft) => this.materialize(draft, rawLine));

    const builtIn = this.builtIns.parse(normalized);
    if (builtIn) {
      diagnostics.push(this.materialize(this.customMatchers.applyBaseMatcher(builtIn), rawLine));
    }
    return diagnostics;
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

/** Built-in parsers requested by the profile plus any that custom matchers extend. */
function enabledBuiltInParsers(
  builtIns: readonly BuiltInDiagnosticParserId[] | undefined,
  customMatchers: readonly NormalizedCustomDiagnosticMatcher[]
): ReadonlySet<BuiltInDiagnosticParserId> {
  const enabled = new Set(builtIns ?? BROAD_CORE_DIAGNOSTIC_PARSERS);
  for (const matcher of customMatchers) {
    if (matcher.base) {
      enabled.add(matcher.base);
    }
  }
  return enabled;
}

export function parseBuildLog(
  text: string,
  options: BuildDiagnosticLogParserOptions = {}
): RawBuildDiagnostic[] {
  const parser = new BuildDiagnosticLogParser(options);
  return [...parser.acceptChunk(text), ...parser.finish()];
}

export { normalizeBuildLogLine } from "./BuildDiagnosticParserSupport";
