import type { DiagnosticProfileValidationIssue } from "./BuildDiagnosticTypes";

export function readOptionalString(
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

export function readRequiredString(
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

export function readOptionalBoundedString(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[],
  maxLength: number
): string | undefined {
  const normalized = readOptionalString(value, issuePath, issues);
  if (normalized && normalized.length > maxLength) {
    addIssue(issues, issuePath, `Value must contain at most ${maxLength} characters.`);
    return undefined;
  }
  return normalized;
}

export function readRequiredBoundedString(
  value: unknown,
  issuePath: string,
  issues: DiagnosticProfileValidationIssue[],
  maxLength: number
): string | undefined {
  const normalized = readRequiredString(value, issuePath, issues);
  if (normalized && normalized.length > maxLength) {
    addIssue(issues, issuePath, `Value must contain at most ${maxLength} characters.`);
    return undefined;
  }
  return normalized;
}

export function reportUnknownProperties(
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

export function addIssue(
  issues: DiagnosticProfileValidationIssue[],
  issuePath: string,
  message: string
): void {
  issues.push({ path: issuePath, message, severity: "error" });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
