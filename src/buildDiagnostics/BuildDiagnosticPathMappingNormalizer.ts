import * as path from "node:path";
import { isSafePattern } from "redos-detector";
import {
  addIssue,
  isRecord,
  readRequiredString,
  reportUnknownProperties
} from "./BuildDiagnosticProfileValidation";
import { validateDiagnosticRegexp } from "./BuildDiagnosticRegexSafety";
import type {
  DiagnosticProfileValidationIssue,
  NormalizedDiagnosticPathMapping
} from "./BuildDiagnosticTypes";

const PREFIX_MAPPING_PROPERTIES = new Set(["type", "remote", "local"]);
const REGEX_MAPPING_PROPERTIES = new Set(["type", "remote", "replace", "local"]);

export function normalizePathMappings(
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
    const mapping = normalizePathMapping(value[index], `${issuePath}[${index}]`, issues);
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
  const localRoot = normalizeRepositoryRelativeRoot(value.local, `${mappingPath}.local`, issues);
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
  const remotePrefix = readRequiredString(value.remote, `${mappingPath}.remote`, issues);
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
  const pattern = readRequiredString(value.remote, `${mappingPath}.remote`, issues);
  const replacement = readRequiredString(value.replace, `${mappingPath}.replace`, issues, true);
  if (!pattern || typeof replacement === "undefined" || typeof localRoot === "undefined") {
    return undefined;
  }
  const validation = validateDiagnosticRegexp(pattern);
  if (!validation.safe || !validation.regexp) {
    addIssue(issues, `${mappingPath}.remote`, validation.reason ?? "Unsafe regular expression.");
    return undefined;
  }
  try {
    if (!isSafePattern(pattern, { maxScore: 200, maxSteps: 500, timeout: 25 }).safe) {
      addIssue(issues, `${mappingPath}.remote`, "Unsafe regular expression for path mapping.");
      return undefined;
    }
  } catch {
    addIssue(
      issues,
      `${mappingPath}.remote`,
      "Unable to verify path mapping regular expression safety."
    );
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

function normalizeRepositoryRelativeRoot(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[]
): string | undefined {
  if (typeof value === "undefined" || value === "" || value === ".") {
    return "";
  }
  if (typeof value !== "string") {
    addIssue(issues, issuePath, "local must be a repository-relative path.");
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
    addIssue(issues, issuePath, "local must stay within the bound repository.");
    return undefined;
  }
  return normalized;
}
