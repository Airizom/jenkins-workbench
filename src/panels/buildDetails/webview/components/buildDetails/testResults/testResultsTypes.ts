import type { BuildTestCaseViewModel } from "../../../../shared/BuildDetailsContracts";

export type TestStatusFilter = "all" | "failed" | "skipped" | "passed";

export type EmptyStateIcon = "loading" | "info" | "empty" | "search";

export interface TestResultsView {
  statusFilter: TestStatusFilter;
  query: string;
  filteredItems: BuildTestCaseViewModel[];
  visibleItems: BuildTestCaseViewModel[];
  autoExpandIds: Set<string>;
  hasMore: boolean;
  passRate: number;
  setStatusFilter: (value: TestStatusFilter) => void;
  setQuery: (value: string) => void;
  showMore: () => void;
}
