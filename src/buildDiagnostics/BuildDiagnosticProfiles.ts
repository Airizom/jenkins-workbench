import * as path from "node:path";
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
import { validateDiagnosticRegexp } from "./BuildDiagnosticRegexSafety";
import {
  BUILT_IN_DIAGNOSTIC_PARSER_IDS,
  type BuiltInDiagnosticParserId,
  type CustomDiagnosticMatcherDefinition,
  type DiagnosticProfileValidationIssue,
  type NormalizedCustomDiagnosticMatcher,
  type NormalizedCustomDiagnosticPattern,
  type NormalizedDiagnosticPathMapping,
  type NormalizedDiagnosticProfile,
  type NormalizedDiagnosticProfiles,
  type ResolvedDiagnosticProfile
} from "./BuildDiagnosticTypes";

const PROFILE_PROPERTIES = new Set([
  "description",
  "builtIns",
  "pathMappings",
  "searchExcludeGlob",
  "excludeGlob",
  "matchers"
]);
const MATCHER_PROPERTIES = new Set(["id", "name", "base", "source", "severity", "pattern"]);
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
const PREFIX_MAPPING_PROPERTIES = new Set(["type", "remote", "local", "remotePrefix", "localRoot"]);
const REGEX_MAPPING_PROPERTIES = new Set([
  "type",
  "remote",
  "replace",
  "local",
  "pattern",
  "replacement",
  "localRoot"
]);
const AUTOMATIC_DIAGNOSTIC_PROFILE_ID = "automatic";
export const BROAD_CORE_DIAGNOSTIC_PARSERS: readonly BuiltInDiagnosticParserId[] = Object.freeze([
  ...BUILT_IN_DIAGNOSTIC_PARSER_IDS
]);

export const AUTOMATIC_DIAGNOSTIC_PROFILE: NormalizedDiagnosticProfile = freezeProfile({
  id: AUTOMATIC_DIAGNOSTIC_PROFILE_ID,
  builtIns: BROAD_CORE_DIAGNOSTIC_PARSERS,
  pathMappings: [],
  matchers: [],
  valid: true
});

export function normalizeDiagnosticProfiles(value: unknown): NormalizedDiagnosticProfiles {
  const issues: DiagnosticProfileValidationIssue[] = [];
  const profiles = new Map<string, NormalizedDiagnosticProfile>();
  const profileIds = new Set<string>();
  if (!isRecord(value)) {
    if (typeof value !== "undefined") {
      addIssue(issues, "profiles", "Profiles must be an object keyed by profile ID.");
    }
    return { profiles, issues };
  }

  for (const [rawId, definition] of Object.entries(value)) {
    const id = rawId.trim();
    const profilePath = `profiles.${rawId}`;
    const issueStart = issues.length;
    if (!id) {
      addIssue(issues, profilePath, "Profile IDs must not be empty.");
      continue;
    }
    if (id === AUTOMATIC_DIAGNOSTIC_PROFILE_ID) {
      addIssue(
        issues,
        profilePath,
        `'${AUTOMATIC_DIAGNOSTIC_PROFILE_ID}' is reserved for automatic broad-core parsing.`
      );
      continue;
    }
    if (profileIds.has(id)) {
      addIssue(issues, profilePath, `Duplicate normalized profile ID '${id}'.`);
      continue;
    }
    profileIds.add(id);
    if (!isRecord(definition)) {
      addIssue(issues, profilePath, "Profile definition must be an object.");
      continue;
    }
    reportUnknownProperties(definition, PROFILE_PROPERTIES, profilePath, issues);

    const description = readOptionalString(
      definition.description,
      `${profilePath}.description`,
      issues
    );
    const builtIns = normalizeBuiltIns(definition.builtIns, `${profilePath}.builtIns`, issues);
    const pathMappings = normalizePathMappings(
      definition.pathMappings,
      `${profilePath}.pathMappings`,
      issues
    );
    const searchExcludeGlob = readOptionalString(
      definition.searchExcludeGlob ?? definition.excludeGlob,
      `${profilePath}.searchExcludeGlob`,
      issues
    );
    const matchers = normalizeMatchers(definition.matchers, `${profilePath}.matchers`, issues);
    const valid = !issues.slice(issueStart).some((issue) => issue.severity === "error");

    profiles.set(
      id,
      freezeProfile({
        id,
        description,
        builtIns,
        pathMappings,
        searchExcludeGlob,
        excludeGlob: searchExcludeGlob,
        matchers,
        valid
      })
    );
  }
  return { profiles, issues };
}

export function resolveDiagnosticProfile(
  normalized: NormalizedDiagnosticProfiles,
  requestedId?: string
): ResolvedDiagnosticProfile {
  if (!requestedId || requestedId === AUTOMATIC_DIAGNOSTIC_PROFILE_ID) {
    return { profile: AUTOMATIC_DIAGNOSTIC_PROFILE };
  }
  const profile = normalized.profiles.get(requestedId);
  if (!profile) {
    return {
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      warning: `Diagnostic profile '${requestedId}' does not exist; using automatic parsing.`
    };
  }
  if (!profile.valid) {
    return {
      profile: AUTOMATIC_DIAGNOSTIC_PROFILE,
      warning: `Diagnostic profile '${requestedId}' is invalid; using automatic parsing.`
    };
  }
  return { profile };
}

function normalizeBuiltIns(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): readonly BuiltInDiagnosticParserId[] {
  if (typeof value === "undefined") {
    return BROAD_CORE_DIAGNOSTIC_PARSERS;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, issuePath, "builtIns must be an array of stable parser IDs.");
    return BROAD_CORE_DIAGNOSTIC_PARSERS;
  }

  const result: BuiltInDiagnosticParserId[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!isBuiltInParserId(candidate)) {
      addIssue(issues, `${issuePath}[${index}]`, `Unknown built-in parser '${String(candidate)}'.`);
      continue;
    }
    if (!result.includes(candidate)) {
      result.push(candidate);
    }
  }
  return result;
}

function normalizePathMappings(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): readonly NormalizedDiagnosticPathMapping[] {
  if (typeof value === "undefined") {
    return [];
  }
  if (!Array.isArray(value)) {
    addIssue(issues, issuePath, "pathMappings must be an array.");
    return [];
  }

  const result: NormalizedDiagnosticPathMapping[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const mappingPath = `${issuePath}[${index}]`;
    const mapping = normalizePathMapping(value[index], mappingPath, issues);
    if (mapping) {
      result.push(mapping);
    }
  }
  return result;
}

function normalizePathMapping(
  value: unknown,
  mappingPath: string,
  issues: DiagnosticProfileValidationIssue[]
): NormalizedDiagnosticPathMapping | undefined {
  if (!isRecord(value)) {
    addIssue(issues, mappingPath, "Path mapping must be an object.");
    return undefined;
  }
  const localRoot = normalizeRepositoryRelativeRoot(
    value.local ?? value.localRoot,
    `${mappingPath}.local`,
    issues
  );
  if (value.type === "prefix") {
    return normalizePrefixPathMapping(value, localRoot, mappingPath, issues);
  }
  if (value.type === "regex") {
    return normalizeRegexPathMapping(value, localRoot, mappingPath, issues);
  }
  addIssue(issues, `${mappingPath}.type`, "Path mapping type must be 'prefix' or 'regex'.");
  return undefined;
}

function normalizePrefixPathMapping(
  value: Record<string, unknown>,
  localRoot: string | undefined,
  mappingPath: string,
  issues: DiagnosticProfileValidationIssue[]
): NormalizedDiagnosticPathMapping | undefined {
  reportUnknownProperties(value, PREFIX_MAPPING_PROPERTIES, mappingPath, issues);
  const remotePrefix = readRequiredString(
    value.remote ?? value.remotePrefix,
    `${mappingPath}.remote`,
    issues
  );
  return remotePrefix && typeof localRoot !== "undefined"
    ? { type: "prefix", remotePrefix, localRoot }
    : undefined;
}

function normalizeRegexPathMapping(
  value: Record<string, unknown>,
  localRoot: string | undefined,
  mappingPath: string,
  issues: DiagnosticProfileValidationIssue[]
): NormalizedDiagnosticPathMapping | undefined {
  reportUnknownProperties(value, REGEX_MAPPING_PROPERTIES, mappingPath, issues);
  const pattern = readRequiredString(
    value.remote ?? value.pattern,
    `${mappingPath}.remote`,
    issues
  );
  const replacement = readRequiredString(
    value.replace ?? value.replacement,
    `${mappingPath}.replace`,
    issues,
    true
  );
  if (!pattern || typeof replacement === "undefined" || typeof localRoot === "undefined") {
    return undefined;
  }
  const validation = validateDiagnosticRegexp(pattern);
  if (!validation.safe || !validation.regexp) {
    addIssue(issues, `${mappingPath}.pattern`, validation.reason ?? "Unsafe regular expression.");
    return undefined;
  }
  return {
    type: "regex",
    pattern,
    regexp: validation.regexp,
    replacement,
    localRoot
  };
}

function normalizeMatchers(
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
    const matcherPath = `${issuePath}[${index}]`;
    const matcher = normalizeMatcher(value[index], index, matcherPath, ids, issues);
    if (matcher) {
      result.push(matcher);
    }
  }
  return result;
}

function normalizeMatcher(
  value: unknown,
  index: number,
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
  const identity = normalizeMatcherIdentity(definition, index, matcherPath, issues);
  reportDuplicateMatcherId(identity.id, ids, matcherPath, issues);
  const base = normalizeBase(definition.base, `${matcherPath}.base`, issues);
  const configuredSource = readOptionalBoundedString(
    definition.source,
    `${matcherPath}.source`,
    issues
  );
  const severity = normalizeMatcherSeverity(definition.severity, `${matcherPath}.severity`, issues);
  const patterns = normalizePatterns(definition.pattern, `${matcherPath}.pattern`, issues);
  validateMatcherPatterns(base, patterns, matcherPath, issues);
  if (issues.length !== issueStart || !identity.id) {
    return undefined;
  }
  ids.add(identity.id);
  return {
    id: identity.id,
    base,
    source: resolveMatcherSource(configuredSource, identity, patterns),
    severity,
    patterns
  };
}

function normalizeMatcherIdentity(
  definition: CustomDiagnosticMatcherDefinition,
  index: number,
  matcherPath: string,
  issues: DiagnosticProfileValidationIssue[]
): { id?: string; name?: string } {
  if (typeof definition.id !== "undefined") {
    return {
      id: readRequiredBoundedString(definition.id, `${matcherPath}.id`, issues),
      name: readOptionalBoundedString(definition.name, `${matcherPath}.name`, issues)
    };
  }
  if (typeof definition.name !== "undefined") {
    const name = readRequiredBoundedString(definition.name, `${matcherPath}.name`, issues);
    return { id: name, name };
  }
  return { id: `custom-${index + 1}` };
}

function reportDuplicateMatcherId(
  id: string | undefined,
  ids: ReadonlySet<string>,
  matcherPath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
  if (id && ids.has(id)) {
    addIssue(issues, `${matcherPath}.id`, `Duplicate matcher ID '${id}'.`);
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
  validateMatcherLoopPositions(patterns, matcherPath, issues);
}

function validateMatcherLoopPositions(
  patterns: readonly NormalizedCustomDiagnosticPattern[],
  matcherPath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
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
  identity: { id?: string; name?: string },
  patterns: readonly NormalizedCustomDiagnosticPattern[]
): string | undefined {
  if (configuredSource || patterns.length === 0) {
    return configuredSource;
  }
  return identity.name ?? identity.id;
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
    validateCapture(value[property], `${patternPath}.${property}`, issues);
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
  addIssue(issues, issuePath, "severity must be 'error', 'warning', or 'info'.");
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

function normalizeRepositoryRelativeRoot(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): string | undefined {
  if (typeof value === "undefined" || value === "" || value === ".") {
    return "";
  }
  if (typeof value !== "string") {
    addIssue(issues, issuePath, "localRoot must be a repository-relative path.");
    return undefined;
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    segments.includes("..")
  ) {
    addIssue(issues, issuePath, "localRoot must stay within the bound repository.");
    return undefined;
  }
  return normalized;
}

function validateCapture(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
  if (typeof value === "undefined") {
    return;
  }
  if (!isCustomMatcherCaptureIndex(value)) {
    addIssue(
      issues,
      issuePath,
      `Capture indexes must be integers from 1 through ${MAX_CUSTOM_MATCHER_CAPTURE_INDEX}.`
    );
  }
}

function readOptionalString(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): string | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value !== "string") {
    addIssue(issues, issuePath, "Expected a string.");
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function readRequiredString(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[],
  allowEmpty = false
): string | undefined {
  if (typeof value !== "string") {
    addIssue(issues, issuePath, "Expected a string.");
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized && !allowEmpty) {
    addIssue(issues, issuePath, "Value must not be empty.");
    return undefined;
  }
  return allowEmpty ? value : normalized;
}

function readOptionalBoundedString(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): string | undefined {
  const normalized = readOptionalString(value, issuePath, issues);
  if (normalized && normalized.length > MAX_CUSTOM_MATCHER_METADATA_LENGTH) {
    addIssue(
      issues,
      issuePath,
      `Value must contain at most ${MAX_CUSTOM_MATCHER_METADATA_LENGTH} characters.`
    );
    return undefined;
  }
  return normalized;
}

function readRequiredBoundedString(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): string | undefined {
  const normalized = readRequiredString(value, issuePath, issues);
  if (normalized && normalized.length > MAX_CUSTOM_MATCHER_METADATA_LENGTH) {
    addIssue(
      issues,
      issuePath,
      `Value must contain at most ${MAX_CUSTOM_MATCHER_METADATA_LENGTH} characters.`
    );
    return undefined;
  }
  return normalized;
}

function reportUnknownProperties(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): void {
  for (const property of Object.keys(value)) {
    if (!allowed.has(property)) {
      addIssue(issues, `${issuePath}.${property}`, `Unsupported property '${property}'.`);
    }
  }
}

function addIssue(
  issues: DiagnosticProfileValidationIssue[],
  issuePath: string,
  message: string
): void {
  issues.push({ path: issuePath, message, severity: "error" });
}

function isBuiltInParserId(value: unknown): value is BuiltInDiagnosticParserId {
  return (
    typeof value === "string" &&
    (BUILT_IN_DIAGNOSTIC_PARSER_IDS as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeProfile(profile: NormalizedDiagnosticProfile): NormalizedDiagnosticProfile {
  const pathMappings = profile.pathMappings.map((mapping) => Object.freeze({ ...mapping }));
  const matchers = profile.matchers.map((matcher) =>
    Object.freeze({
      ...matcher,
      patterns: Object.freeze(matcher.patterns.map((pattern) => Object.freeze({ ...pattern })))
    })
  );
  return Object.freeze({
    ...profile,
    builtIns: Object.freeze([...profile.builtIns]),
    pathMappings: Object.freeze(pathMappings),
    matchers: Object.freeze(matchers)
  });
}
