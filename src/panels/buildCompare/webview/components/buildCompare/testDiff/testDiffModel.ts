/** Rows rendered per test group before "Show more". */
export const TEST_DIFF_PAGE_SIZE = 50;

/** Search box appears once the changed tests no longer fit at a glance. */
export const TEST_DIFF_SEARCH_MIN_ITEMS = 10;

interface TestIdentity {
  name: string;
  className?: string;
  suiteName?: string;
}

export function normalizeTestDiffQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Case-insensitive match against suite, class, and test name. */
export function filterTestDiffItems<T extends TestIdentity>(items: T[], query: string): T[] {
  const needle = normalizeTestDiffQuery(query);
  if (!needle) {
    return items;
  }
  return items.filter((item) =>
    [item.name, item.className, item.suiteName].some((value) =>
      value?.toLowerCase().includes(needle)
    )
  );
}

/** Label for the "Show more" button, e.g. "Show 50 more (120 remaining)". */
export function showMoreTestsLabel(remaining: number): string {
  const next = Math.min(TEST_DIFF_PAGE_SIZE, remaining);
  return next === remaining
    ? `Show ${remaining.toLocaleString()} more`
    : `Show ${next.toLocaleString()} more (${remaining.toLocaleString()} remaining)`;
}
