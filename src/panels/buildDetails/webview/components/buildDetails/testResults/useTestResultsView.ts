import * as React from "react";
import type {
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel
} from "../../../../shared/BuildDetailsContracts";
import type { TestResultsView, TestStatusFilter } from "./testResultsTypes";
import {
  RENDER_BATCH_SIZE,
  filterTestResults,
  getAutoExpandIds,
  getPassRate,
  getTestResultsDatasetKey
} from "./testResultsUtils";

const { useEffect, useMemo, useState } = React;

export function useTestResultsView({
  buildUrl,
  summary,
  results
}: {
  buildUrl?: string;
  summary: BuildTestsSummaryViewModel;
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
  const passRate = getPassRate(summary);

  return {
    statusFilter,
    query,
    filteredItems,
    visibleItems,
    autoExpandIds,
    hasMore,
    passRate,
    setStatusFilter,
    setQuery,
    showMore: () => setRenderCount((current) => current + RENDER_BATCH_SIZE)
  };
}
