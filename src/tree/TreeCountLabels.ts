export function formatCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Truncated activity lists only know a lower bound, so render it as "N+".
export function formatBoundedCount(count: number, isTruncated: boolean): string {
  return isTruncated ? `${count}+` : `${count}`;
}
