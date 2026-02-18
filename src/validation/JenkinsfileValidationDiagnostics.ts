import * as vscode from "vscode";
import type { JenkinsfileValidationFinding } from "./JenkinsfileValidationTypes";
import { setDiagnosticMetadata } from "./JenkinsfileDiagnosticMetadata";
import { JENKINS_DIAGNOSTIC_SOURCE } from "./JenkinsfileDiagnosticUtils";
import { findTokenOccurrence, isTokenChar } from "./JenkinsfileValidationUtils";

export function buildValidationDiagnostics(
  document: vscode.TextDocument,
  findings: JenkinsfileValidationFinding[]
): vscode.Diagnostic[] {
  if (findings.length === 0) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const lineCount = Math.max(document.lineCount, 1);

  for (const finding of findings) {
    const range = resolveFindingRange(document, finding, lineCount);
    const diagnostic = new vscode.Diagnostic(
      range,
      finding.message,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = JENKINS_DIAGNOSTIC_SOURCE;
    if (finding.code) {
      diagnostic.code = finding.code;
    }
    if (finding.suggestions?.length) {
      diagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(document.uri, range),
          `Possible steps: ${finding.suggestions.join(", ")}`
        )
      ];
    }
    setDiagnosticMetadata(diagnostic, {
      code: finding.code,
      suggestions: finding.suggestions,
      invalidStepToken: finding.invalidStepToken
    });
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

export function buildNoEnvironmentDiagnostic(document: vscode.TextDocument): vscode.Diagnostic {
  const lineText = document.lineCount > 0 ? document.lineAt(0).text : "";
  const range = buildLineRange(0, lineText);
  const diagnostic = new vscode.Diagnostic(
    range,
    "Select a Jenkins environment to enable Jenkinsfile validation.",
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = JENKINS_DIAGNOSTIC_SOURCE;
  diagnostic.code = "no-environment";
  setDiagnosticMetadata(diagnostic, { code: "no-environment" });
  return diagnostic;
}

function resolveFindingRange(
  document: vscode.TextDocument,
  finding: JenkinsfileValidationFinding,
  lineCount: number
): vscode.Range {
  const lineNumber = typeof finding.line === "number" ? finding.line : 1;
  const clampedLine = Math.min(Math.max(1, lineNumber), lineCount) - 1;
  const lineText = document.lineAt(clampedLine).text;

  if (typeof finding.column === "number" && Number.isFinite(finding.column)) {
    return resolveRangeFromColumn(clampedLine, lineText, finding.column);
  }

  const tokenHint = deriveTokenHint(finding.message);
  if (tokenHint) {
    const tokenIndex = findTokenOccurrence(lineText, tokenHint);
    if (tokenIndex !== undefined) {
      return buildTokenRange(clampedLine, tokenIndex, tokenHint.length);
    }

    if (tokenHint === "pipeline") {
      const pipelineRange = findFirstTokenInDocument(document, tokenHint);
      if (pipelineRange) {
        return pipelineRange;
      }
    }
  }

  return buildLineRange(clampedLine, lineText);
}

function resolveRangeFromColumn(lineIndex: number, lineText: string, column: number): vscode.Range {
  const lineLength = lineText.length;
  if (lineLength === 0) {
    return buildLineRange(lineIndex, lineText);
  }

  const startIndex = Math.min(Math.max(1, column) - 1, lineLength);
  let index = startIndex;
  while (index < lineLength && isWhitespace(lineText[index])) {
    index += 1;
  }

  if (index >= lineLength) {
    return buildLineRange(lineIndex, lineText);
  }

  if (!isTokenChar(lineText[index])) {
    return new vscode.Range(lineIndex, index, lineIndex, lineLength);
  }

  let end = index + 1;
  while (end < lineLength && isTokenChar(lineText[end])) {
    end += 1;
  }
  return new vscode.Range(lineIndex, index, lineIndex, end);
}

function buildLineRange(lineIndex: number, lineText: string): vscode.Range {
  if (lineText.length === 0) {
    return new vscode.Range(lineIndex, 0, lineIndex, 0);
  }
  const firstNonWhitespace = lineText.search(/\S/);
  const start = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
  return new vscode.Range(lineIndex, start, lineIndex, lineText.length);
}

function deriveTokenHint(message: string): string | undefined {
  const missingSectionMatch = message.match(/Missing required section ['"]([^'"]+)['"]/i);
  if (missingSectionMatch) {
    const section = missingSectionMatch[1].trim().toLowerCase();
    if (section === "stages" || section === "agent") {
      return "pipeline";
    }
    return section.length > 0 ? section : undefined;
  }

  const invalidSectionMatch = message.match(
    /Invalid section definition ['"]?([A-Za-z0-9_-]+)['"]?/i
  );
  if (invalidSectionMatch) {
    return invalidSectionMatch[1].trim().toLowerCase();
  }

  const unknownSectionMatch = message.match(/Unknown section ['"]?([A-Za-z0-9_-]+)['"]?/i);
  if (unknownSectionMatch) {
    return unknownSectionMatch[1].trim().toLowerCase();
  }

  return undefined;
}

function findFirstTokenInDocument(
  document: vscode.TextDocument,
  token: string
): vscode.Range | undefined {
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const tokenIndex = findTokenOccurrence(lineText, token);
    if (tokenIndex !== undefined) {
      return buildTokenRange(lineIndex, tokenIndex, token.length);
    }
  }
  return undefined;
}

function buildTokenRange(lineIndex: number, start: number, length: number): vscode.Range {
  return new vscode.Range(lineIndex, start, lineIndex, start + length);
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}
