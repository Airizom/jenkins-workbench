function tryParseEnvironmentUrl(rawUrl: string): URL | undefined {
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
