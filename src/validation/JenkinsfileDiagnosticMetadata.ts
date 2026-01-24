import type * as vscode from "vscode";
import type { JenkinsfileValidationCode } from "./JenkinsfileValidationTypes";

export interface JenkinsfileDiagnosticMetadata {
  code?: JenkinsfileValidationCode;
  suggestions?: string[];
  invalidStepToken?: string;
}

const diagnosticMetadata = new WeakMap<vscode.Diagnostic, JenkinsfileDiagnosticMetadata>();

export function setDiagnosticMetadata(
  diagnostic: vscode.Diagnostic,
  metadata: JenkinsfileDiagnosticMetadata
): void {
  diagnosticMetadata.set(diagnostic, metadata);
}

export function getDiagnosticMetadata(
  diagnostic: vscode.Diagnostic
): JenkinsfileDiagnosticMetadata | undefined {
  return diagnosticMetadata.get(diagnostic);
}
