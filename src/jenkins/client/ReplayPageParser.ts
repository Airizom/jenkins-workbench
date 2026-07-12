import type { JenkinsReplayDefinition, JenkinsReplayLoadedScript } from "../types";

const RUN_FORM_PATTERN = /<form\b[^>]*\baction\s*=\s*(["'])run\1[^>]*>([\s\S]*?)<\/form>/i;
const REBUILD_FORM_PATTERN = /<form\b[^>]*\baction\s*=\s*(["'])rebuild\1[^>]*>/i;
const FORM_ITEM_PATTERN =
  /<div\b[^>]*class\s*=\s*(["'])[^"'<>]*\bjenkins-form-item\b[^"'<>]*\1[^>]*>/gi;
const LABEL_PATTERN =
  /<div\b[^>]*class\s*=\s*(["'])[^"'<>]*\bjenkins-form-label\b[^"'<>]*\1[^>]*>([\s\S]*?)<\/div>/i;
const TEXTAREA_PATTERN = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/i;
const FIELD_NAME_PATTERN = /\bname\s*=\s*(["'])(.*?)\1/i;
const WHITESPACE_PATTERN = /\s+/g;
const WINDOWS_NEWLINE_PATTERN = /\r\n?/g;
const LEADING_TEXTAREA_NEWLINE_PATTERN = /^\n[ \t]*/;
const TRAILING_TEXTAREA_NEWLINE_PATTERN = /\n[ \t]*$/;
const TAG_PATTERN = /<[^>]+>/g;
const HTML_ENTITY_PATTERN = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;

type ParsedReplayEntry = {
  field: string;
  label: string;
  script: string;
};

export function parseReplayDefinitionPage(html: string): JenkinsReplayDefinition {
  const formHtml = extractRunForm(html);
  const entries = extractReplayEntries(formHtml);
  let mainScript: string | undefined;
  const loadedScripts: JenkinsReplayLoadedScript[] = [];
  for (const entry of entries) {
    if (entry.field === "mainScript") {
      mainScript ??= entry.script;
      continue;
    }

    loadedScripts.push({
      displayName: entry.label,
      postField: entry.field,
      script: entry.script
    });
  }

  if (mainScript === undefined) {
    throw createReplayParseError("Missing mainScript field in replay form.");
  }

  return {
    mainScript,
    loadedScripts
  };
}

function extractRunForm(html: string): string {
  const match = html.match(RUN_FORM_PATTERN);
  if (match?.[2]) {
    return match[2];
  }

  if (REBUILD_FORM_PATTERN.test(html)) {
    throw new Error(
      "This build does not support editable replay. Jenkins exposed rebuild instead of the replay editor."
    );
  }

  throw createReplayParseError('Replay form action="run" was not found.');
}

function extractReplayEntries(formHtml: string): ParsedReplayEntry[] {
  const entries: ParsedReplayEntry[] = [];
  let previousStart: number | undefined;

  FORM_ITEM_PATTERN.lastIndex = 0;
  let marker = FORM_ITEM_PATTERN.exec(formHtml);
  while (marker) {
    const start = marker.index;
    if (previousStart !== undefined) {
      appendReplayEntry(entries, formHtml.slice(previousStart, start));
    }
    previousStart = start;
    marker = FORM_ITEM_PATTERN.exec(formHtml);
  }

  if (previousStart !== undefined) {
    appendReplayEntry(entries, formHtml.slice(previousStart));
  }

  if (entries.length === 0) {
    throw createReplayParseError("No replay script entries were found in the replay form.");
  }

  return entries;
}

function appendReplayEntry(entries: ParsedReplayEntry[], block: string): void {
  const entry = parseReplayEntry(block);
  if (entry) {
    entries.push(entry);
  }
}

function parseReplayEntry(block: string): ParsedReplayEntry | undefined {
  const textareaMatch = block.match(TEXTAREA_PATTERN);
  if (!textareaMatch) {
    return undefined;
  }

  const field = extractFieldName(textareaMatch[1]);
  if (!field) {
    throw createReplayParseError("Replay textarea is missing a Jenkins form field name.");
  }

  const labelMatch = block.match(LABEL_PATTERN);
  const label = normalizeLabel(labelMatch?.[2]);
  if (!label) {
    throw createReplayParseError(`Replay field ${field} is missing a human-readable label.`);
  }

  return {
    field,
    label,
    script: normalizeTextareaContent(textareaMatch[2])
  };
}

function extractFieldName(attributes: string): string | undefined {
  const nameMatch = attributes.match(FIELD_NAME_PATTERN);
  const rawName = nameMatch?.[2]?.trim();
  if (!rawName) {
    return undefined;
  }
  return rawName.startsWith("_.") ? rawName.slice(2) : rawName;
}

function normalizeLabel(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const text = decodeHtmlEntities(stripTags(input)).replace(WHITESPACE_PATTERN, " ").trim();
  return text.length > 0 ? text : undefined;
}

function normalizeTextareaContent(input: string): string {
  return decodeHtmlEntities(input)
    .replace(WINDOWS_NEWLINE_PATTERN, "\n")
    .replace(LEADING_TEXTAREA_NEWLINE_PATTERN, "")
    .replace(TRAILING_TEXTAREA_NEWLINE_PATTERN, "");
}

function stripTags(input: string): string {
  return input.replace(TAG_PATTERN, "");
}

function decodeHtmlEntities(input: string): string {
  return input.replace(HTML_ENTITY_PATTERN, (_match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!isValidUnicodeScalar(value)) {
        return `&${entity};`;
      }
      try {
        return String.fromCodePoint(value);
      } catch {
        return `&${entity};`;
      }
    }

    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
      case "#39":
        return "'";
      case "nbsp":
        return " ";
      default:
        return `&${entity};`;
    }
  });
}

function isValidUnicodeScalar(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff)
  );
}

function createReplayParseError(reason: string): Error {
  return new Error(`Jenkins replay page did not match the expected ReplayAction form. ${reason}`);
}
