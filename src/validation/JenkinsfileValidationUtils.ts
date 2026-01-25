import type { JenkinsfileValidationCode } from "./JenkinsfileValidationTypes";

const MAX_SUGGESTIONS = 10;
const MISSING_SECTION_PATTERN = /Missing required section ['"]([^'"]+)['"]/i;
const INVALID_SECTION_DEFINITION_PATTERN = /Not a valid section definition:\s*['"]([^'"]+)['"]/i;
const BLOCKED_STEP_PATTERN =
  /Invalid step ['"]?([A-Za-z0-9_-]+)['"]? used - not allowed in this context/i;
const UNKNOWN_DSL_PATTERNS = [
  /No such DSL method\b/i,
  /No such step\b/i,
  /Unknown step\b/i,
  /found among steps\b/i
];
const INVALID_STEP_TOKEN_PATTERNS = [
  /Invalid step ['"]?([A-Za-z0-9_-]+)['"]?/i,
  /No such DSL method ['"]?([A-Za-z0-9_-]+)['"]?/i,
  /No such step ['"]?([A-Za-z0-9_-]+)['"]?/i,
  /Unknown step ['"]?([A-Za-z0-9_-]+)['"]?/i
];
const TOKEN_CHAR_PATTERN = /[A-Za-z0-9_-]/;

export function deriveValidationCode(message: string): JenkinsfileValidationCode | undefined {
  const missingSectionMatch = message.match(MISSING_SECTION_PATTERN);
  if (missingSectionMatch) {
    const section = missingSectionMatch[1].trim().toLowerCase();
    if (section === "agent") {
      return "missing-agent";
    }
    if (section === "stages") {
      return "missing-stages";
    }
  }

  if (INVALID_SECTION_DEFINITION_PATTERN.test(message)) {
    return "invalid-section-definition";
  }

  if (BLOCKED_STEP_PATTERN.test(message)) {
    return "blocked-step";
  }

  if (UNKNOWN_DSL_PATTERNS.some((pattern) => pattern.test(message))) {
    return "unknown-dsl-method";
  }

  if (/Invalid step\b/i.test(message)) {
    return "invalid-step";
  }

  return undefined;
}

export function extractSuggestionsFromLine(line: string): string[] {
  if (!/^(Did you mean|Possible steps)/i.test(line.trim())) {
    return [];
  }
  return extractSuggestionsFromText(line);
}

export function extractSuggestionsFromText(message: string): string[] {
  const suggestions: string[] = [];
  const didYouMeanMatch = message.match(/Did you mean\s+(.+?)(?:\?|$)/i);
  if (didYouMeanMatch) {
    suggestions.push(...parseSuggestionList(didYouMeanMatch[1]));
  }

  const possibleStepsMatch = message.match(/Possible steps?\s*:\s*(.+)$/i);
  if (possibleStepsMatch) {
    suggestions.push(...parseSuggestionList(possibleStepsMatch[1]));
  }

  return uniqueSuggestions(suggestions);
}

export function mergeSuggestions(
  existing: string[] | undefined,
  incoming: string[]
): string[] | undefined {
  if (incoming.length === 0) {
    return existing;
  }
  if (!existing || existing.length === 0) {
    return uniqueSuggestions(incoming);
  }
  return uniqueSuggestions([...existing, ...incoming]);
}

export function uniqueSuggestions(values: string[]): string[] {
  if (values.length === 0) {
    return values;
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value);
    if (result.length >= MAX_SUGGESTIONS) {
      break;
    }
  }
  return result;
}

export function extractInvalidStepToken(message: string): string | undefined {
  for (const pattern of INVALID_STEP_TOKEN_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

export function isTokenChar(value: string | undefined): boolean {
  return value !== undefined && TOKEN_CHAR_PATTERN.test(value);
}

export function findTokenOccurrence(lineText: string, token: string): number | undefined {
  let found: number | undefined;
  scanTokenOccurrences(lineText, token, (index) => {
    found = index;
    return false;
  });
  return found;
}

export function findTokenOccurrences(lineText: string, token: string): number[] {
  const occurrences: number[] = [];
  scanTokenOccurrences(lineText, token, (index) => {
    occurrences.push(index);
    return true;
  });
  return occurrences;
}

function scanTokenOccurrences(
  lineText: string,
  token: string,
  onMatch: (index: number) => boolean
): void {
  const lowerLine = lineText.toLowerCase();
  const lowerToken = token.toLowerCase();
  let index = lowerLine.indexOf(lowerToken);
  while (index !== -1) {
    const beforeIndex = index - 1;
    const afterIndex = index + token.length;
    const beforeOk = beforeIndex < 0 || !isTokenChar(lineText[beforeIndex]);
    const afterOk = afterIndex >= lineText.length || !isTokenChar(lineText[afterIndex]);
    if (beforeOk && afterOk) {
      if (!onMatch(index)) {
        return;
      }
    }
    index = lowerLine.indexOf(lowerToken, index + 1);
  }
}

function parseSuggestionList(value: string): string[] {
  const trimmed = value.replace(/[\[\]]/g, "").trim();
  if (!trimmed) {
    return [];
  }

  const quoted = [...trimmed.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1].trim());
  if (quoted.length > 0) {
    return quoted.filter((item) => item.length > 0);
  }

  return trimmed
    .split(/\s*,\s*|\s+or\s+/i)
    .map((item) => item.replace(/[?.]$/, "").trim())
    .filter((item) => item.length > 0);
}
