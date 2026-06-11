/**
 * Parses a `vscode.Uri.query` string without decoding it again.
 *
 * `vscode.Uri.parse` already percent-decodes the query once; feeding it to
 * `URLSearchParams` would decode a second time (and turn "+" into a space),
 * corrupting values such as multibranch job URLs with %2F-encoded branch
 * names. Pairs are split on "&" and on the first "=" only, keeping the raw
 * key and value. The first occurrence of a key wins.
 */
export function parseUriQueryParams(query: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (pair.length === 0) {
      continue;
    }
    const separatorIndex = pair.indexOf("=");
    const key = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1);
    if (!params.has(key)) {
      params.set(key, value);
    }
  }
  return params;
}
