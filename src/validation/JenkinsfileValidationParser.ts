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
  /^(?:Jenkinsfile )?successfully validated\.?$/i,
  /^jenkinsfile is valid\.?$/i,
  /^validation (?:succeeded|successful)\.?$/i
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

  const findings: JenkinsfileValidationFinding[] = [];
  let lastFinding: JenkinsfileValidationFinding | undefined;

  let lineStart = 0;
  while (lineStart < normalized.length) {
    const newlineIndex = normalized.indexOf("\n", lineStart);
    const rawLine =
      newlineIndex === -1 ? normalized.slice(lineStart) : normalized.slice(lineStart, newlineIndex);
    lineStart = newlineIndex === -1 ? normalized.length : newlineIndex + 1;
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

  if (findings.length === 0 && SUCCESS_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return [];
  }

  return findings.length > 0 ? findings : [{ message: normalized }];
}

function parseJsonValidationOutput(text: string): JenkinsfileValidationFinding[] | undefined {
  if (!text.startsWith("{") && !text.startsWith("[")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    const errors = extractJsonErrors(parsed);
    if (!errors) {
      return undefined;
    }
    if (errors.length === 0) {
      return [];
    }

    const findings: JenkinsfileValidationFinding[] = [];
    for (const error of errors) {
      findings.push(...parseJsonErrors(error));
    }
    if (findings.length === 0 && errors.length > 0) {
      findings.push({ message: text });
    }
    return findings;
  } catch {
    return undefined;
  }
}

function extractJsonErrors(value: unknown): unknown[] | undefined {
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
    return errors;
  }

  if (typeof result === "string" && /^(?:success|ok)$/i.test(result.trim())) {
    return [];
  }

  return undefined;
}

function parseJsonErrors(error: unknown): JenkinsfileValidationFinding[] {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const messages = record.message ?? record.Message ?? record.error ?? record.Error;
    if (Array.isArray(messages)) {
      return messages.flatMap((message) =>
        typeof message === "string" ? parseJsonErrors({ ...record, message }) : []
      );
    }
  }
  const finding = parseJsonError(error);
  return finding ? [finding] : [];
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
  if (typeof message !== "string" || !message) {
    return undefined;
  }

  const line = toNumber(record.line ?? record.Line);
  const column = toNumber(record.column ?? record.Column);
  const embedded =
    line === undefined || column === undefined ? parseFindingLine(message) : undefined;
  return buildFinding(
    embedded?.message ?? message,
    line ?? embedded?.line,
    column ?? embedded?.column
  );
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

function parseFindingLine(line: string): JenkinsfileValidationFinding | undefined {
  const workflowMatch = line.match(/^WorkflowScript:\s*(\d+):\s*(.*)$/);
  const detail = workflowMatch ? workflowMatch[2].trim() : line;
  const locationMatch =
    detail.match(/@ line (\d+)(?:, column (\d+))?/i) ??
    (workflowMatch ? undefined : detail.match(/\bline (\d+)(?:, column (\d+))?/i));
  const resolvedLineText = locationMatch?.[1] ?? workflowMatch?.[1];
  if (!resolvedLineText) {
    return undefined;
  }

  const resolvedLine = Number.parseInt(resolvedLineText, 10);
  const resolvedColumn = locationMatch?.[2] ? Number.parseInt(locationMatch[2], 10) : undefined;
  const message = stripLineReference(detail);
  return buildFinding(message || line, resolvedLine, resolvedColumn);
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
