export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function buildApiUrlFromBase(baseUrl: string, path: string, tree?: string): string {
  const base = ensureTrailingSlash(baseUrl);
  const url = new URL(path, base);
  if (tree) {
    url.searchParams.set("tree", tree);
  }
  return url.toString();
}

export function buildApiUrlFromItem(itemUrl: string, tree?: string): string {
  const base = ensureTrailingSlash(itemUrl);
  const url = new URL("api/json", base);
  if (tree) {
    url.searchParams.set("tree", tree);
  }
  return url.toString();
}

export function buildActionUrl(itemUrl: string, action: string): string {
  const base = ensureTrailingSlash(itemUrl);
  const url = new URL(action, base);
  return url.toString();
}

export function isAuthRedirect(location: string, baseUrl: string): boolean {
  const target = new URL(location, baseUrl);
  const path = target.pathname.toLowerCase();

  return (
    path.includes("/login") ||
    path.includes("/securityrealm") ||
    path.includes("/j_acegi_security_check") ||
    path.includes("/j_security_check")
  );
}
