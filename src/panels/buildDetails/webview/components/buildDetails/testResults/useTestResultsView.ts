import * as React from "react";
import type { BuildTestResultsViewModel } from "../../../../shared/BuildDetailsContracts";
import type { TestResultsView, TestStatusFilter } from "./testResultsTypes";
import { filterTestResults, getAutoExpandIds, RENDER_BATCH_SIZE } from "./testResultsUtils";

const { useCallback, useEffect, useMemo, useRef, useState } = React;

export function useTestResultsView({
  buildUrl,
  results,
  failedCount
}: {
  buildUrl?: string;
  results: BuildTestResultsViewModel;
  failedCount: number;
}): TestResultsView {
  const [statusFilter, setStatusFilterState] = useState<TestStatusFilter>(() =>
    failedCount > 0 ? "failed" : "all"
  );
  // Set once the filter is decided: by the failed-tests default or by the
  // user. Afterwards the filter only changes when the user changes it.
  const filterSettledRef = useRef(failedCount > 0);
  const [query, setQuery] = useState("");
  const [renderCount, setRenderCount] = useState(RENDER_BATCH_SIZE);

  const filteredItems = useMemo(
    () => filterTestResults(results.items, statusFilter, query),
    [query, results.items, statusFilter]
  );

  const autoExpandIds = useMemo(() => getAutoExpandIds(results.items), [results.items]);

  useEffect(() => {
    setRenderCount(RENDER_BATCH_SIZE);
  }, [query, statusFilter]);

  const previousBuildUrlRef = useRef(buildUrl);
  useEffect(() => {
    if (previousBuildUrlRef.current === buildUrl) {
      return;
    }
    previousBuildUrlRef.current = buildUrl;
    filterSettledRef.current = false;
    setStatusFilterState("all");
    setQuery("");
    setRenderCount(RENDER_BATCH_SIZE);
  }, [buildUrl]);

  // Test results often arrive after the tab mounts; default to failures the
  // first time any are reported.
  useEffect(() => {
    if (filterSettledRef.current || failedCount <= 0) {
      return;
    }
    filterSettledRef.current = true;
    setStatusFilterState("failed");
  }, [failedCount]);

  const setStatusFilter = useCallback((value: TestStatusFilter) => {
    filterSettledRef.current = true;
    setStatusFilterState(value);
  }, []);

  const clearFilters = useCallback(() => {
    filterSettledRef.current = true;
    setStatusFilterState("all");
    setQuery("");
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
