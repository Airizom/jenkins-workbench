import * as React from "react";
import type { BuildTestResultsViewModel } from "../../../../shared/BuildDetailsContracts";
import type { TestResultsView, TestStatusFilter } from "./testResultsTypes";
import { filterTestResults, getAutoExpandIds, RENDER_BATCH_SIZE } from "./testResultsUtils";

const { useCallback, useMemo, useState } = React;

export function useTestResultsView({
  buildUrl,
  results,
  failedCount
}: {
  buildUrl?: string;
  results: BuildTestResultsViewModel;
  failedCount: number;
}): TestResultsView {
  const [filter, setFilter] = useState<TestStatusFilter | undefined>(
    failedCount > 0 ? "failed" : undefined
  );
  const [previousBuildUrl, setPreviousBuildUrl] = useState(buildUrl);
  const [query, setQueryState] = useState("");
  const [renderCount, setRenderCount] = useState(RENDER_BATCH_SIZE);
  if (previousBuildUrl !== buildUrl) {
    setPreviousBuildUrl(buildUrl);
    setFilter(failedCount > 0 ? "failed" : undefined);
    setQueryState("");
    setRenderCount(RENDER_BATCH_SIZE);
  } else if (filter === undefined && failedCount > 0) {
    // Latch the failed-tests default when late results arrive, unless the user chose a filter.
    setFilter("failed");
    setRenderCount(RENDER_BATCH_SIZE);
  }
  const statusFilter = filter ?? "all";

  const filteredItems = useMemo(
    () => filterTestResults(results.items, statusFilter, query),
    [query, results.items, statusFilter]
  );
  const autoExpandIds = useMemo(() => getAutoExpandIds(results.items), [results.items]);

  const setStatusFilter = useCallback((value: TestStatusFilter) => {
    setFilter(value);
    setRenderCount(RENDER_BATCH_SIZE);
  }, []);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setRenderCount(RENDER_BATCH_SIZE);
  }, []);

  const clearFilters = useCallback(() => {
    setFilter("all");
    setQueryState("");
    setRenderCount(RENDER_BATCH_SIZE);
  }, []);

  const visibleItems = filteredItems.slice(0, renderCount);
  const hasMore = filteredItems.length > visibleItems.length;

  return {
    statusFilter,
    query,
    filteredItems,
    visibleItems,
    autoExpandIds,
    hasMore,
    setStatusFilter,
    setQuery,
    clearFilters,
    showMore: () => setRenderCount((current) => current + RENDER_BATCH_SIZE)
  };
}
