import type { JenkinsReplayDefinition, JenkinsReplayLoadedScript } from "../types";

const RUN_FORM_PATTERN = /<form\b[^>]*\baction\s*=\s*(["'])run\1[^>]*>([\s\S]*?)<\/form>/i;
const REBUILD_FORM_PATTERN = /<form\b[^>]*\baction\s*=\s*(["'])rebuild\1[^>]*>/i;
const FORM_ITEM_PATTERN =
  /<div\b[^>]*class\s*=\s*(["'])[^"'<>]*\bjenkins-form-item\b[^"'<>]*\1[^>]*>/gi;
const LABEL_PATTERN =
  /<div\b[^>]*class\s*=\s*(["'])[^"'<>]*\bjenkins-form-label\b[^"'<>]*\1[^>]*>([\s\S]*?)<\/div>/i;
const TEXTAREA_PATTERN = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/i;

type ParsedReplayEntry = {
  field: string;
  label: string;
  script: string;
};

export function parseReplayDefinitionPage(html: string): JenkinsReplayDefinition {
  const formHtml = extractRunForm(html);
  const entries = extractReplayEntries(formHtml);
  const mainScript = entries.find((entry) => entry.field === "mainScript");
  if (!mainScript) {
    throw createReplayParseError("Missing mainScript field in replay form.");
  }

  return {
    mainScript: mainScript.script,
    loadedScripts: entries
      .filter((entry) => entry.field !== "mainScript")
      .map(
        (entry): JenkinsReplayLoadedScript => ({
          displayName: entry.label,
          postField: entry.field,
          script: entry.script
        })
      )
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
  const markers = Array.from(formHtml.matchAll(FORM_ITEM_PATTERN));
  const entries: ParsedReplayEntry[] = [];

  for (let index = 0; index < markers.length; index += 1) {
    const start = markers[index]?.index;
    if (start === undefined) {
      continue;
    }
    const end = markers[index + 1]?.index ?? formHtml.length;
    const block = formHtml.slice(start, end);
    const entry = parseReplayEntry(block);
    if (entry) {
      entries.push(entry);
    }
  }

  if (entries.length === 0) {
    throw createReplayParseError("No replay script entries were found in the replay form.");
  }

  return entries;
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
  const nameMatch = attributes.match(/\bname\s*=\s*(["'])(.*?)\1/i);
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

  const text = decodeHtmlEntities(stripTags(input)).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : undefined;
}

function normalizeTextareaContent(input: string): string {
  return decodeHtmlEntities(input)
    .replace(/\r\n?/g, "\n")
    .replace(/^\n[ \t]*/, "")
    .replace(/\n[ \t]*$/, "");
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
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

function createReplayParseError(reason: string): Error {
  return new Error(`Jenkins replay page did not match the expected ReplayAction form. ${reason}`);
}
