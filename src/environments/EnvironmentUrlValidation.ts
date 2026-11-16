/**
 * Jenkins base URL validation shared by environment prompts and settings declarations.
 * Kept free of `vscode` so pure parsers can use it.
 */

/** An http(s) URL without embedded credentials, query, or fragment; undefined otherwise. */
export function parseHttpUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url.trim());
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function normalizeJenkinsUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    const trimmed = url.trim();
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }

  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }

  return parsed.toString();
}
