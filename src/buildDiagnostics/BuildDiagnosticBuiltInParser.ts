import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import {
  type DiagnosticDraft,
  looksLikeStandaloneSourcePath,
  type NormalizedLogLine,
  parseGccClang,
  parseGeneric,
  parseGo,
  parseMsvc,
  parseTypeScript,
  positiveInteger,
  severityFromText
} from "./BuildDiagnosticParserSupport";
import { BuildDiagnosticStackTraceParser } from "./BuildDiagnosticStackTraceParser";
import type { BuiltInDiagnosticParserId } from "./BuildDiagnosticTypes";

type BuiltInLineParser = (line: NormalizedLogLine) => DiagnosticDraft | undefined;

/**
 * Runs the enabled built-in parsers against one normalized line and returns
 * the first match. Owns the multiline state for ESLint file headers, Rust
 * error headers, and stack traces.
 */
export class BuildDiagnosticBuiltInParser {
  private readonly parsers: readonly BuiltInLineParser[];
  private readonly stacks = new BuildDiagnosticStackTraceParser();
  private eslintPath: string | undefined;
  private rustHeader:
    | { severity: BuildDiagnosticSeverity; code?: string; message: string }
    | undefined;

  constructor(enabled: ReadonlySet<BuiltInDiagnosticParserId>) {
    // Order matters: the first parser that produces a draft wins.
    const ordered: [BuiltInDiagnosticParserId, BuiltInLineParser][] = [
      ["typescript", (line) => parseTypeScript(line.text)],
      ["msvc", (line) => parseMsvc(line.text)],
      ["gcc-clang", (line) => parseGccClang(line.text, line.prefixSeverity)],
      ["eslint", (line) => this.parseEslint(line.text)],
      ["rust", (line) => this.parseRust(line.text)],
      ["go", (line) => parseGo(line.text, line.prefixSeverity)],
      ["jvm-stack", (line) => this.stacks.parseJvmStack(line.text)],
      ["javascript-stack", (line) => this.stacks.parseJavaScriptStack(line.text)],
      ["python-traceback", (line) => this.stacks.parsePythonStack(line.text)],
      ["dotnet-stack", (line) => this.stacks.parseDotnetStack(line.text)],
      ["generic", (line) => parseGeneric(line.text, line.prefixSeverity)]
    ];
    this.parsers = ordered.filter(([id]) => enabled.has(id)).map(([, parser]) => parser);
  }

  /** Closes stack traces that the given line cannot continue. */
  endTerminatedStacks(text: string): void {
    this.stacks.endTerminatedStacks(text);
  }

  parse(line: NormalizedLogLine): DiagnosticDraft | undefined {
    for (const parser of this.parsers) {
      const result = parser(line);
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
}
