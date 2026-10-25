export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DEFAULT_PLAIN_TEXT_DESCRIPTION_LENGTH = 300;
const ELLIPSIS = "…";

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};

// Jenkins renders build descriptions through the configured markup formatter, so the raw
// value may be HTML. This reduces it to readable text for tooltips and panels; callers must
// still treat the result as untrusted text (for example via MarkdownString.appendText).
export function toPlainTextDescription(
  value: string | null | undefined,
  maxLength: number = DEFAULT_PLAIN_TEXT_DESCRIPTION_LENGTH
): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const withoutMarkup = value
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|li|ul|ol|tr|table|h[1-6]|pre|blockquote|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?[a-z!/?][^>]*>/gi, "");
  const text = decodeHtmlEntities(withoutMarkup)
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  if (text.length === 0) {
    return undefined;
  }
  return truncateWithEllipsis(text, maxLength);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function truncateWithEllipsis(value: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return value;
  }
  const limit = Math.max(1, Math.floor(maxLength));
  const codePoints = Array.from(value);
  if (codePoints.length <= limit) {
    return value;
  }
  return `${codePoints
    .slice(0, limit - 1)
    .join("")
    .trimEnd()}${ELLIPSIS}`;
}
