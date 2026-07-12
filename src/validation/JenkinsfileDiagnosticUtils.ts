import type * as vscode from "vscode";
import { getDiagnosticMetadata } from "./JenkinsfileDiagnosticMetadata";
import type { JenkinsfileValidationCode } from "./JenkinsfileValidationTypes";
import {
  deriveValidationCode,
  extractSuggestionsFromText,
  uniqueSuggestions
} from "./JenkinsfileValidationUtils";

export const JENKINS_DIAGNOSTIC_SOURCE = "jenkins";

const VALIDATION_CODES = new Set<JenkinsfileValidationCode>([
  "missing-agent",
  "missing-stages",
  "invalid-section-definition",
  "blocked-step",
  "unknown-dsl-method",
  "invalid-step",
  "request-failed",
  "no-environment"
]);

function isValidationCode(value: string): value is JenkinsfileValidationCode {
  return VALIDATION_CODES.has(value as JenkinsfileValidationCode);
}

export function resolveDiagnosticCode(
  diagnostic: vscode.Diagnostic
): JenkinsfileValidationCode | undefined {
  const metadata = getDiagnosticMetadata(diagnostic);
  if (metadata?.code) {
    return metadata.code;
  }
  if (diagnostic.source !== JENKINS_DIAGNOSTIC_SOURCE) {
    return undefined;
  }

  const code = diagnostic.code;
  if (typeof code === "string") {
    return isValidationCode(code) ? code : undefined;
  }
  if (typeof code === "object" && code && "value" in code && typeof code.value === "string") {
    return isValidationCode(code.value) ? code.value : undefined;
  }
  return deriveValidationCode(diagnostic.message);
}

export function resolveDiagnosticSuggestions(diagnostic: vscode.Diagnostic): string[] {
  const metadata = getDiagnosticMetadata(diagnostic);
  if (metadata?.suggestions?.length) {
    return uniqueSuggestions(metadata.suggestions);
  }

  const related = diagnostic.relatedInformation ?? [];
  const fromRelated = related.flatMap((info) => extractSuggestionsFromText(info.message));
  if (fromRelated.length > 0) {
    return uniqueSuggestions(fromRelated);
  }

  return extractSuggestionsFromText(diagnostic.message);
}
