import * as path from "node:path";

export function normalizePosixRelativePath(value: string): string | undefined {
  const cleaned = value.replace(/\\/g, "/").trim();
  if (!cleaned) {
    return undefined;
  }
  const normalized = path.posix.normalize(cleaned);
  const withoutLeading = normalized.replace(/^\/+/g, "");
  const segments = withoutLeading
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    return undefined;
  }
  if (segments.some((segment) => segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}
