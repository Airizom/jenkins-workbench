export function formatEnvironmentLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname && parsed.pathname !== "/"
      ? `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`
      : parsed.host;
  } catch {
    return rawUrl;
  }
}
