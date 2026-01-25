import type {
  JenkinsfileValidationCode,
  JenkinsfileValidationFinding
} from "./JenkinsfileValidationTypes";
import {
  deriveValidationCode,
  extractInvalidStepToken,
  extractSuggestionsFromLine,
  extractSuggestionsFromText,
  mergeSuggestions
} from "./JenkinsfileValidationUtils";

const SUCCESS_PATTERNS = [
  /successfully validated/i,
  /jenkinsfile is valid/i,
  /validation (succeeded|successful)/i
];

const IGNORE_PATTERNS = [/^errors encountered validating jenkinsfile/i];

const SUGGESTION_CODES: JenkinsfileValidationCode[] = [
  "invalid-step",
  "unknown-dsl-method",
  "blocked-step"
];
const INVALID_STEP_TOKEN_CODES: JenkinsfileValidationCode[] = [
  "invalid-step",
  "unknown-dsl-method"
];

export function parseDeclarativeValidationOutput(text: string): JenkinsfileValidationFinding[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const jsonFindings = parseJsonValidationOutput(normalized);
  if (jsonFindings) {
    return jsonFindings;
  }

  if (SUCCESS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return [];
  }

  const findings: JenkinsfileValidationFinding[] = [];
  let lastFinding: JenkinsfileValidationFinding | undefined;

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (IGNORE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    const suggestionLine = extractSuggestionsFromLine(line);
    if (suggestionLine.length > 0 && lastFinding && isSuggestionCode(lastFinding.code)) {
      lastFinding.suggestions = mergeSuggestions(lastFinding.suggestions, suggestionLine);
      continue;
    }

    const finding = parseFindingLine(line);
    if (finding) {
      findings.push(finding);
      lastFinding = finding;
    }
  }

  if (findings.length === 0) {
    findings.push({
      message: normalized
    });
  }

  return findings;
}

function parseJsonValidationOutput(text: string): JenkinsfileValidationFinding[] | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const extracted = extractJsonErrors(parsed);
    if (!extracted) {
      return undefined;
    }
    if (extracted.errors.length === 0) {
      return [];
    }

    const findings: JenkinsfileValidationFinding[] = [];
    for (const error of extracted.errors) {
      const finding = parseJsonError(error);
      if (finding) {
        findings.push(finding);
      }
    }
    if (findings.length === 0 && extracted.errors.length > 0) {
      findings.push({ message: trimmed });
    }
    return findings;
  } catch {
    return undefined;
  }
}

function extractJsonErrors(value: unknown): { errors: unknown[]; result?: string } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const root = value as Record<string, unknown>;
  const data =
    (root.data as Record<string, unknown> | undefined) ??
    (root.Data as Record<string, unknown> | undefined);
  const container = data ?? root;
  const errors =
    (container.errors as unknown[] | undefined) ?? (container.Errors as unknown[] | undefined);
  const result =
    (container.result as string | undefined) ??
    (container.Result as string | undefined) ??
    (root.status as string | undefined) ??
    (root.Status as string | undefined);

  if (Array.isArray(errors)) {
    return { errors, result };
  }

  if (result && /success|ok/i.test(result)) {
    return { errors: [] };
  }

  return undefined;
}

function parseJsonError(error: unknown): JenkinsfileValidationFinding | undefined {
  if (typeof error === "string") {
    return parseFindingLine(error) ?? buildFinding(error);
  }

  if (!error || typeof error !== "object") {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const message =
    (record.message as string | undefined) ??
    (record.Message as string | undefined) ??
    (record.error as string | undefined) ??
    (record.Error as string | undefined);
  if (!message) {
    return undefined;
  }

  const line = toNumber(record.line ?? record.Line);
  const column = toNumber(record.column ?? record.Column);
  return buildFinding(message, line, column);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stripLineReference(value: string): string {
  return value.replace(/\s*@ line \d+(?:, column \d+)?/gi, "").trim();
}

function buildFindingFromLine(
  line: string,
  message: string,
  resolvedLine: number,
  resolvedColumn?: number
): JenkinsfileValidationFinding {
  const resolvedMessage = message || line;
  return buildFinding(resolvedMessage, resolvedLine, resolvedColumn);
}

function parseFindingLine(line: string): JenkinsfileValidationFinding | undefined {
  const workflowMatch = line.match(/^WorkflowScript:\s*(\d+):\s*(.*)$/);
  if (workflowMatch) {
    const parsedLine = Number.parseInt(workflowMatch[1], 10);
    const detail = workflowMatch[2].trim();
    const refMatch = detail.match(/@ line (\d+)(?:, column (\d+))?/i);
    const resolvedLine = refMatch ? Number.parseInt(refMatch[1], 10) : parsedLine;
    const resolvedColumn = refMatch?.[2] ? Number.parseInt(refMatch[2], 10) : undefined;
    const message = stripLineReference(detail);
    return buildFindingFromLine(line, message, resolvedLine, resolvedColumn);
  }

  const atMatch = line.match(/@ line (\d+)(?:, column (\d+))?/i);
  if (atMatch) {
    const resolvedLine = Number.parseInt(atMatch[1], 10);
    const resolvedColumn = atMatch[2] ? Number.parseInt(atMatch[2], 10) : undefined;
    const message = stripLineReference(line);
    return buildFindingFromLine(line, message, resolvedLine, resolvedColumn);
  }

  const lineMatch = line.match(/\bline (\d+)(?:, column (\d+))?/i);
  if (lineMatch) {
    const resolvedLine = Number.parseInt(lineMatch[1], 10);
    const resolvedColumn = lineMatch[2] ? Number.parseInt(lineMatch[2], 10) : undefined;
    const message = stripLineReference(line);
    return buildFindingFromLine(line, message, resolvedLine, resolvedColumn);
  }

  return undefined;
}

function buildFinding(
  message: string,
  line?: number,
  column?: number
): JenkinsfileValidationFinding {
  const code = deriveValidationCode(message);
  const suggestions = isSuggestionCode(code) ? extractSuggestionsFromText(message) : undefined;
  const invalidStepToken = isInvalidStepTokenCode(code)
    ? extractInvalidStepToken(message)
    : undefined;
  return {
    message,
    line: Number.isFinite(line) ? line : undefined,
    column: Number.isFinite(column) ? column : undefined,
    code,
    suggestions: suggestions && suggestions.length > 0 ? suggestions : undefined,
    invalidStepToken
  };
}

function isSuggestionCode(code: JenkinsfileValidationCode | undefined): boolean {
  return !!code && SUGGESTION_CODES.includes(code);
}

function isInvalidStepTokenCode(code: JenkinsfileValidationCode | undefined): boolean {
  return !!code && INVALID_STEP_TOKEN_CODES.includes(code);
}
