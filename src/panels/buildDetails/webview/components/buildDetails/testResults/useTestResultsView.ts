import * as React from "react";
import type { BuildTestResultsViewModel } from "../../../../shared/BuildDetailsContracts";
import type { TestResultsView, TestStatusFilter } from "./testResultsTypes";
import {
  filterTestResults,
  getAutoExpandIds,
  getTestResultsDatasetKey,
  RENDER_BATCH_SIZE
} from "./testResultsUtils";

const { useEffect, useMemo, useState } = React;

export function useTestResultsView({
  buildUrl,
  results
}: {
  buildUrl?: string;
  results: BuildTestResultsViewModel;
}): TestResultsView {
  const [statusFilter, setStatusFilter] = useState<TestStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [renderCount, setRenderCount] = useState(RENDER_BATCH_SIZE);
  const datasetKey = useMemo(
    () => getTestResultsDatasetKey(buildUrl, results.items),
    [buildUrl, results.items]
  );

  const filteredItems = useMemo(
    () => filterTestResults(results.items, statusFilter, query),
    [query, results.items, statusFilter]
  );

  const autoExpandIds = useMemo(() => getAutoExpandIds(results.items), [results.items]);

  useEffect(() => {
    setRenderCount(RENDER_BATCH_SIZE);
  }, [query, statusFilter]);

  useEffect(() => {
    setStatusFilter("all");
    setQuery("");
    setRenderCount(RENDER_BATCH_SIZE);
  }, [datasetKey]);

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
    showMore: () => setRenderCount((current) => current + RENDER_BATCH_SIZE)
  };
}
