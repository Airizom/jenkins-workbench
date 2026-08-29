import { normalizeMatchers } from "./BuildDiagnosticMatcherNormalizer";
import { normalizePathMappings } from "./BuildDiagnosticPathMappingNormalizer";
import {
  addIssue,
  isRecord,
  readOptionalString,
  reportUnknownProperties
} from "./BuildDiagnosticProfileValidation";
import {
  BUILT_IN_DIAGNOSTIC_PARSER_IDS,
  type BuiltInDiagnosticParserId,
  type DiagnosticProfileValidationIssue,
  type NormalizedDiagnosticProfile,
  type NormalizedDiagnosticProfiles,
  type ResolvedDiagnosticProfile
} from "./BuildDiagnosticTypes";

const PROFILE_PROPERTIES = new Set([
  "description",
  "builtIns",
  "pathMappings",
  "searchExcludeGlob",
  "matchers"
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
      definition.searchExcludeGlob,
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

function isBuiltInParserId(value: unknown): value is BuiltInDiagnosticParserId {
  return (
    typeof value === "string" &&
    (BUILT_IN_DIAGNOSTIC_PARSER_IDS as readonly string[]).includes(value)
  );
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
