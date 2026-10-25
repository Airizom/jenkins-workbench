/** Canonicalize each path segment without confusing escaped slashes with separators. */
export function canonicalNodeUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
  return url.toString();
}
