export function normalizeStatusToken(value?: string): string {
  return (value ?? "").trim().toUpperCase();
}
