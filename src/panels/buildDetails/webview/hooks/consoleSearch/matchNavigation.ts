export type SearchDirection = "next" | "prev";

export function getNextActiveMatchIndex({
  previousIndex,
  direction,
  isSearchActive,
  matchCount
}: {
  previousIndex: number;
  direction: SearchDirection;
  isSearchActive: boolean;
  matchCount: number;
}): number {
  if (!isSearchActive || matchCount === 0) {
    return -1;
  }

  if (previousIndex < 0) {
    return direction === "next" ? 0 : matchCount - 1;
  }

  const delta = direction === "next" ? 1 : -1;
  return (previousIndex + delta + matchCount) % matchCount;
}
