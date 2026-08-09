export function advanceRangeIndex<Range>(
  ranges: readonly Range[],
  startIndex: number,
  offset: number,
  getEndOffset: (range: Range) => number
): number {
  let index = startIndex;
  while (index < ranges.length && getEndOffset(ranges[index]) <= offset) {
    index += 1;
  }
  return index;
}

export function buildRangeIntervals(
  boundaries: ReadonlySet<number>
): Array<{ start: number; end: number }> {
  const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
  const intervals: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    if (end > start) {
      intervals.push({ start, end });
    }
  }
  return intervals;
}
