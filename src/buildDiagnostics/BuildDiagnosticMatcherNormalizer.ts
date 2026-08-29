import type { BuildDiagnosticSeverity } from "../shared/BuildDiagnosticContracts";
import {
  CUSTOM_MATCHER_CAPTURE_PROPERTIES,
  createNormalizedCustomDiagnosticPattern,
  isCustomMatcherCaptureIndex,
  isCustomMatcherLoop,
  isCustomMatcherLoopAllowed,
  isCustomMatcherPatternKind,
  MAX_CUSTOM_MATCHER_CAPTURE_INDEX,
  MAX_CUSTOM_MATCHER_METADATA_LENGTH,
  MAX_CUSTOM_MATCHER_PATTERNS,
  MAX_CUSTOM_MATCHERS,
  validateCustomMatcherPatternRegexp
} from "./BuildDiagnosticCustomMatcherProtocol";
import {
  addIssue,
  isRecord,
  readOptionalBoundedString,
  readRequiredBoundedString,
  readRequiredString,
  reportUnknownProperties
} from "./BuildDiagnosticProfileValidation";
import {
  BUILT_IN_DIAGNOSTIC_PARSER_IDS,
  type BuiltInDiagnosticParserId,
  type CustomDiagnosticMatcherDefinition,
  type DiagnosticProfileValidationIssue,
  type NormalizedCustomDiagnosticMatcher,
  type NormalizedCustomDiagnosticPattern
} from "./BuildDiagnosticTypes";

const MATCHER_PROPERTIES = new Set(["name", "base", "source", "severity", "pattern"]);
const PATTERN_PROPERTIES = new Set([
  "regexp",
  "kind",
  "file",
  "location",
  "line",
  "column",
  "endLine",
  "endColumn",
  "severity",
  "code",
  "message",
  "loop"
]);

export function normalizeMatchers(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): readonly NormalizedCustomDiagnosticMatcher[] {
  if (typeof value === "undefined") {
    return [];
  }
  if (!Array.isArray(value)) {
    addIssue(issues, issuePath, "matchers must be an array.");
    return [];
  }
  if (value.length > MAX_CUSTOM_MATCHERS) {
    addIssue(issues, issuePath, `matchers must contain at most ${MAX_CUSTOM_MATCHERS} entries.`);
  }

  const result: NormalizedCustomDiagnosticMatcher[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < Math.min(value.length, MAX_CUSTOM_MATCHERS); index += 1) {
    const matcher = normalizeMatcher(value[index], `${issuePath}[${index}]`, ids, issues);
    if (matcher) {
      result.push(matcher);
    }
  }
  return result;
}

function normalizeMatcher(
  value: unknown,
  matcherPath: string,
  ids: Set<string>,
  issues: DiagnosticProfileValidationIssue[]
): NormalizedCustomDiagnosticMatcher | undefined {
  if (!isRecord(value)) {
    addIssue(issues, matcherPath, "Matcher must be an object.");
    return undefined;
  }
  const issueStart = issues.length;
  reportUnknownProperties(value, MATCHER_PROPERTIES, matcherPath, issues);
  const definition = value as unknown as CustomDiagnosticMatcherDefinition;
  const id = normalizeMatcherIdentity(definition, matcherPath, issues);
  reportDuplicateMatcherId(id, ids, matcherPath, issues);
  const base = normalizeBase(definition.base, `${matcherPath}.base`, issues);
  const configuredSource = readOptionalBoundedString(
    definition.source,
    `${matcherPath}.source`,
    issues,
    MAX_CUSTOM_MATCHER_METADATA_LENGTH
  );
  const severity = normalizeMatcherSeverity(definition.severity, `${matcherPath}.severity`, issues);
  const patterns = normalizePatterns(definition.pattern, `${matcherPath}.pattern`, issues);
  validateMatcherPatterns(base, patterns, matcherPath, issues);
  if (issues.length !== issueStart || !id) {
    return undefined;
  }
  ids.add(id);
  return {
    id,
    base,
    source: resolveMatcherSource(configuredSource, id, patterns),
    severity,
    patterns
  };
}

function normalizeMatcherIdentity(
  definition: CustomDiagnosticMatcherDefinition,
  matcherPath: string,
  issues: DiagnosticProfileValidationIssue[]
): string | undefined {
  return readRequiredBoundedString(
    definition.name,
    `${matcherPath}.name`,
    issues,
    MAX_CUSTOM_MATCHER_METADATA_LENGTH
  );
}

function reportDuplicateMatcherId(
  id: string | undefined,
  ids: ReadonlySet<string>,
  matcherPath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
  if (id && ids.has(id)) {
    addIssue(issues, `${matcherPath}.name`, `Duplicate matcher name '${id}'.`);
  }
}

function validateMatcherPatterns(
  base: BuiltInDiagnosticParserId | undefined,
  patterns: readonly NormalizedCustomDiagnosticPattern[],
  matcherPath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
  if (!base && patterns.length === 0) {
    addIssue(issues, matcherPath, "Matcher requires a pattern or a supported base matcher.");
  }
  if (patterns.length > 0 && !patterns.some((pattern) => typeof pattern.file === "number")) {
    addIssue(
      issues,
      `${matcherPath}.pattern`,
      "Custom matcher patterns must define a file capture."
    );
  }
  for (let index = 0; index < patterns.length - 1; index += 1) {
    if (!isCustomMatcherLoopAllowed(patterns[index].loop, false)) {
      addIssue(
        issues,
        `${matcherPath}.pattern[${index}].loop`,
        "Only the final pattern may use loop."
      );
    }
  }
}

function resolveMatcherSource(
  configuredSource: string | undefined,
  id: string,
  patterns: readonly NormalizedCustomDiagnosticPattern[]
): string | undefined {
  if (configuredSource || patterns.length === 0) {
    return configuredSource;
  }
  return id;
}

function normalizePatterns(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): readonly NormalizedCustomDiagnosticPattern[] {
  if (typeof value === "undefined") {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    addIssue(issues, issuePath, "Pattern array must not be empty.");
    return [];
  }
  if (values.length > MAX_CUSTOM_MATCHER_PATTERNS) {
    addIssue(
      issues,
      issuePath,
      `Pattern arrays must contain at most ${MAX_CUSTOM_MATCHER_PATTERNS} entries.`
    );
  }

  const result: NormalizedCustomDiagnosticPattern[] = [];
  for (let index = 0; index < Math.min(values.length, MAX_CUSTOM_MATCHER_PATTERNS); index += 1) {
    const patternPath = Array.isArray(value) ? `${issuePath}[${index}]` : issuePath;
    const pattern = normalizePattern(values[index], patternPath, issues);
    if (pattern) {
      result.push(pattern);
    }
  }
  return result;
}

function normalizePattern(
  value: unknown,
  patternPath: string,
  issues: DiagnosticProfileValidationIssue[]
): NormalizedCustomDiagnosticPattern | undefined {
  if (!isRecord(value)) {
    addIssue(issues, patternPath, "Pattern must be an object.");
    return undefined;
  }
  const issueStart = issues.length;
  reportUnknownProperties(value, PATTERN_PROPERTIES, patternPath, issues);
  const regexpSource = readRequiredString(value.regexp, `${patternPath}.regexp`, issues);
  const regexp = normalizePatternRegexp(regexpSource, patternPath, issues);
  const kind = normalizePatternKind(value.kind, `${patternPath}.kind`, issues);
  validatePatternCaptures(value, patternPath, issues);
  if (!isCustomMatcherLoop(value.loop)) {
    addIssue(issues, `${patternPath}.loop`, "loop must be a boolean.");
  }
  if (issues.length !== issueStart || !regexpSource || !regexp) {
    return undefined;
  }
  return createNormalizedCustomDiagnosticPattern(
    value,
    regexpSource,
    regexp,
    kind,
    value.loop as boolean | undefined
  );
}

function normalizePatternRegexp(
  regexpSource: string | undefined,
  patternPath: string,
  issues: DiagnosticProfileValidationIssue[]
): RegExp | undefined {
  if (!regexpSource) {
    return undefined;
  }
  const validation = validateCustomMatcherPatternRegexp(regexpSource);
  if (!validation.safe || !validation.regexp) {
    addIssue(issues, `${patternPath}.regexp`, validation.reason ?? "Unsafe regular expression.");
    return undefined;
  }
  return validation.regexp;
}

function validatePatternCaptures(
  value: Record<string, unknown>,
  patternPath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
  for (const property of CUSTOM_MATCHER_CAPTURE_PROPERTIES) {
    const capture = value[property];
    if (typeof capture !== "undefined" && !isCustomMatcherCaptureIndex(capture)) {
      addIssue(
        issues,
        `${patternPath}.${property}`,
        `Capture indexes must be integers from 1 through ${MAX_CUSTOM_MATCHER_CAPTURE_INDEX}.`
      );
    }
  }
}

function normalizeBase(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): BuiltInDiagnosticParserId | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "string") {
    addIssue(issues, issuePath, "base must name a built-in parser.");
    return undefined;
  }
  const normalized = value.startsWith("$") ? value.slice(1) : value;
  if (!isBuiltInParserId(normalized)) {
    addIssue(issues, issuePath, `Unknown base matcher '${value}'.`);
    return undefined;
  }
  return normalized;
}

function normalizeMatcherSeverity(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): BuildDiagnosticSeverity | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (value === "error" || value === "warning" || value === "information") {
    return value;
  }
  if (value === "info") {
    return "information";
  }
  addIssue(issues, issuePath, "severity must be 'error', 'warning', 'info', or 'information'.");
  return undefined;
}

function normalizePatternKind(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): "file" | "location" {
  if (typeof value === "undefined" || value === "location") {
    return "location";
  }
  if (isCustomMatcherPatternKind(value)) {
    return value;
  }
  addIssue(issues, issuePath, "kind must be 'file' or 'location'.");
  return "location";
}

function isBuiltInParserId(value: unknown): value is BuiltInDiagnosticParserId {
  return (
    typeof value === "string" &&
    (BUILT_IN_DIAGNOSTIC_PARSER_IDS as readonly string[]).includes(value)
  );
}
