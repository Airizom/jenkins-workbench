import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";

export const BUILT_IN_DIAGNOSTIC_PARSER_IDS = [
  "gcc-clang",
  "msvc",
  "typescript",
  "eslint",
  "rust",
  "go",
  "jvm-stack",
  "javascript-stack",
  "python-traceback",
  "dotnet-stack",
  "generic"
] as const;

export type BuiltInDiagnosticParserId = (typeof BUILT_IN_DIAGNOSTIC_PARSER_IDS)[number];

export function isBuiltInParserId(value: unknown): value is BuiltInDiagnosticParserId {
  return (
    typeof value === "string" &&
    (BUILT_IN_DIAGNOSTIC_PARSER_IDS as readonly string[]).includes(value)
  );
}

export type BuildDiagnosticKind = "problem" | "stack-frame";

/**
 * A parser result before workspace path resolution. Source coordinates use the
 * one-based convention emitted by build tools.
 */
export interface RawBuildDiagnostic {
  parserId: string;
  /** Built-in parser that produced this result before a base matcher restyled it. */
  baseParserId?: string;
  source: string;
  severity: BuildDiagnosticSeverity;
  message: string;
  rawPath: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  code?: string;
  kind: BuildDiagnosticKind;
  priority: number;
  logLine: number;
  rawText: string;
  sequence: number;
  stackTraceId?: string;
  stackFrameIndex?: number;
}

export interface NormalizedPrefixPathMapping {
  type: "prefix";
  remotePrefix: string;
  localRoot: string;
}

export interface NormalizedRegexPathMapping {
  type: "regex";
  pattern: string;
  regexp: RegExp;
  replacement: string;
  localRoot: string;
}

export type NormalizedDiagnosticPathMapping =
  | NormalizedPrefixPathMapping
  | NormalizedRegexPathMapping;

/**
 * JSON-safe copy of path mappings. Shared by the scan-cache fingerprint and
 * the path-resolution cache key so both change together when a mapping does.
 */
export function serializePathMappings(
  mappings: readonly NormalizedDiagnosticPathMapping[]
): Array<NormalizedPrefixPathMapping | Omit<NormalizedRegexPathMapping, "regexp">> {
  return mappings.map((mapping) => {
    if (mapping.type === "prefix") {
      return mapping;
    }
    const { regexp: _regexp, ...serializable } = mapping;
    return serializable;
  });
}

export type CustomDiagnosticPatternKind = "file" | "location";

/** Capture indexes are one-based, matching VS Code's problem matcher schema. */
export interface CustomDiagnosticPatternDefinition {
  regexp: string;
  kind?: CustomDiagnosticPatternKind;
  file?: number;
  location?: number;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity?: number;
  code?: number;
  message?: number;
  loop?: boolean;
}

export interface CustomDiagnosticMatcherDefinition {
  name: string;
  base?: string;
  source?: string;
  severity?: BuildDiagnosticSeverity | "info";
  pattern?: CustomDiagnosticPatternDefinition | readonly CustomDiagnosticPatternDefinition[];
}

export interface NormalizedCustomDiagnosticPattern
  extends Omit<CustomDiagnosticPatternDefinition, "regexp"> {
  regexpSource: string;
  regexp: RegExp;
  kind: CustomDiagnosticPatternKind;
}

export interface NormalizedCustomDiagnosticMatcher {
  id: string;
  source?: string;
  severity?: BuildDiagnosticSeverity;
  base?: BuiltInDiagnosticParserId;
  patterns: readonly NormalizedCustomDiagnosticPattern[];
}

export interface NormalizedDiagnosticProfile {
  id: string;
  description?: string;
  builtIns: readonly BuiltInDiagnosticParserId[];
  pathMappings: readonly NormalizedDiagnosticPathMapping[];
  searchExcludeGlob?: string;
  matchers: readonly NormalizedCustomDiagnosticMatcher[];
  valid: boolean;
}

export interface DiagnosticProfileValidationIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface NormalizedDiagnosticProfiles {
  profiles: ReadonlyMap<string, NormalizedDiagnosticProfile>;
  issues: readonly DiagnosticProfileValidationIssue[];
}

export interface ResolvedDiagnosticProfile {
  profile: NormalizedDiagnosticProfile;
  warning?: string;
}
