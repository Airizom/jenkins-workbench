export function normalizeStatusToken(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}

const FAILED_STATUS_TOKENS = new Set(["FAILURE", "FAILED", "ERROR", "UNSTABLE", "ABORTED"]);

export function isFailedStatusToken(value?: string): boolean {
  return FAILED_STATUS_TOKENS.has(normalizeStatusToken(value));
}
