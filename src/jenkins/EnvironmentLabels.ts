function tryParseEnvironmentUrl(rawUrl: string): URL | undefined {
  // Bare "host:port" values parse as a custom scheme, so treat them as HTTPS hosts instead.
  if (!rawUrl.includes("://")) {
    try {
      return new URL(`https://${rawUrl}`);
    } catch {
      // Fall through to parse the value as-is.
    }
  }
  try {
    return new URL(rawUrl);
  } catch {
    try {
      return new URL(`https://${rawUrl}`);
    } catch {
      return undefined;
    }
  }
}

export function formatEnvironmentLabel(rawUrl: string): string {
  const parsed = tryParseEnvironmentUrl(rawUrl);
  if (!parsed) {
    return rawUrl;
  }
  const host = parsed.host || parsed.hostname;
  const path = parsed.pathname.replace(/\/+$/, "");
  return path && path !== "/" ? `${host}${path}` : host || rawUrl;
}
