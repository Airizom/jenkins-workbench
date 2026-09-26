/**
 * Parses a `vscode.Uri.query` string without decoding it again.
 *
 * `vscode.Uri.parse` already percent-decodes the query once; feeding it to
 * `URLSearchParams` would decode a second time (and turn "+" into a space),
 * corrupting values such as multibranch job URLs with %2F-encoded branch
 * names. Pairs are split on "&" and on the first "=" only, keeping the raw
 * key and value. When knownKeys is provided, unrecognized pairs belong to
 * the preceding value because their ampersand may have been encoded in the
 * original URI. Once the URL value has a nested query, all following pairs
 * belong to it: VS Code has already erased the distinction between encoded
 * ampersands and outer separators. Put outer node parameters before url when
 * linking to a URL with a query. The first occurrence of a key wins.
 */
export function parseUriQueryParams(
  query: string,
  knownKeys?: ReadonlySet<string>
): Map<string, string> {
  const params = new Map<string, string>();
  let currentKey: string | undefined;
  for (const pair of query.split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const separatorIndex = pair.indexOf("=");
    const key = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1);
    const nestedUrlQuery = currentKey === "url" && params.get("url")?.includes("?");
    if (currentKey !== undefined && (nestedUrlQuery || (knownKeys && !knownKeys.has(key)))) {
      params.set(currentKey, `${params.get(currentKey)}&${pair}`);
      continue;
    }
    currentKey = params.has(key) ? undefined : key;
    if (!params.has(key)) {
      params.set(key, value);
    }
  }
  return params;
}

/** Parses the unambiguous deep-link form: payload=base64url(JSON fields). */
export function parseDeepLinkPayload(query: string): Map<string, string> | undefined {
  if (!query.startsWith("payload=") || query.includes("&")) {
    return undefined;
  }
  const encoded = query.slice("payload=".length);
  if (encoded.length === 0 || encoded.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const fields = value as Record<string, unknown>;
    if (typeof fields.url !== "string" || fields.url.length === 0) {
      return undefined;
    }
    const result = new Map<string, string>([["url", fields.url]]);
    for (const key of ["nodeId", "nodeKind", "nodeName"] as const) {
      const field = fields[key];
      if (field !== undefined) {
        if (typeof field !== "string") {
          return undefined;
        }
        result.set(key, field);
      }
    }
    return result;
  } catch {
    return undefined;
  }
}
