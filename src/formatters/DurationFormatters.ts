export function formatDurationMs(duration?: number): string {
  if (duration === undefined || !Number.isFinite(duration)) {
    return "Unknown";
  }
  const normalizedDuration = Math.max(0, Math.floor(duration));
  if (normalizedDuration < 1000) {
    return `${normalizedDuration} ms`;
  }
  const totalSeconds = Math.floor(normalizedDuration / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}
