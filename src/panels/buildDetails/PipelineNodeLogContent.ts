import { uniqueNonEmptyStrings } from "../../shared/arrays";
import { escapeHtml } from "../../shared/html";

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export { escapeHtml };

export function uniqueStrings(values: string[]): string[] {
  return uniqueNonEmptyStrings(values);
}
