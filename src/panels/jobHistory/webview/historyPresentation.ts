import { formatOptionalLocaleTimestamp } from "../../../formatters/DisplayFormatters";
import type { HistoryOutcome, TestHistory } from "../../../history/HistoryAnalysis";
import type { StatusVisualTone } from "../../shared/TestStatusStyles";
import type { HistorySort, HistoryUiState, HistoryViewModel } from "../shared/HistoryContracts";

export const HISTORY_PAGE_SIZE = 50;

export interface OutcomePresentation {
  label: string;
  tone: StatusVisualTone;
  /** Ambiguous and unavailable observations are evidence gaps, never passes. */
  gap: boolean;
  tooltip?: string;
}

const OUTCOMES: Record<HistoryOutcome, OutcomePresentation> = {
  passed: { label: "Passed", tone: "passed", gap: false },
  failed: { label: "Failed", tone: "failed", gap: false },
  skipped: { label: "Skipped", tone: "skipped", gap: false },
  ambiguous: {
    label: "Ambiguous",
    tone: "neutral",
    gap: true,
    tooltip: "Duplicate test identity: more than one case shares this suite, class and name."
  },
  missing: {
    label: "Not reported",
    tone: "neutral",
    gap: true,
    tooltip: "This build's test report does not include this test."
  },
  unavailable: {
    label: "Unavailable",
    tone: "neutral",
    gap: true,
    tooltip: "The test report for this build is unavailable or was truncated."
  },
  error: {
    label: "Unavailable",
    tone: "neutral",
    gap: true,
    tooltip: "The test report for this build could not be loaded."
  },
  unknown: {
    label: "Unknown",
    tone: "neutral",
    gap: true,
    tooltip: "Jenkins reported a status that is not passed, failed or skipped."
  }
};

export function outcomePresentation(outcome: HistoryOutcome | undefined): OutcomePresentation {
  return OUTCOMES[outcome ?? "unavailable"] ?? OUTCOMES.unavailable;
}

interface FailureCounts {
  failing: number;
  fresh: number;
  stillFailing: number;
  intermittent: number;
  baselineMatches: number;
}

export function selectedBuildIndex(model: HistoryViewModel): number {
  return model.builds.findIndex((item) => item.build.number === model.selectedBuild);
}

function failureCounts(model: HistoryViewModel): FailureCounts {
  const index = selectedBuildIndex(model);
  const failing = model.tests.filter((test) => test.outcomes[index] === "failed");
  const evidence = Object.values(model.evidence);
  return {
    failing: failing.length,
    fresh: evidence.filter((value) => value.kind === "new").length,
    stillFailing: evidence.filter((value) => value.kind === "continuing").length,
    intermittent: failing.filter((test) => test.intermittent).length,
    baselineMatches: failing.filter((test) => model.baselineOutcomes?.[test.key] === "failed")
      .length
  };
}

/** One-line state for the embedded "Failure history" disclosure. */
export function failureHistorySummary(model: HistoryViewModel, buildRunning = false): string {
  const summary = loadedFailureSummary(model, buildRunning);
  if (summary !== undefined) return summary;
  // Counts describe the selected build's report; a missing report is not "no failures".
  const report = model.builds[selectedBuildIndex(model)]?.report;
  if (report?.status !== "available") return "Test report unavailable for this build";
  const counts = failureCounts(model);
  const parts = [
    counts.failing ? `${counts.failing} failing` : "",
    counts.fresh ? `${counts.fresh} new` : "",
    counts.stillFailing ? `${counts.stillFailing} still failing` : "",
    counts.intermittent ? `${counts.intermittent} intermittent` : "",
    counts.baselineMatches ? `${counts.baselineMatches} also failing in baseline` : ""
  ].filter(Boolean);
  if (report.truncated)
    return ["Test report partial", parts.length ? parts.join(" · ") : "0 failing"].join(" · ");
  return parts.length ? parts.join(" · ") : "No failing tests";
}

function loadedFailureSummary(model: HistoryViewModel, buildRunning: boolean): string | undefined {
  if (buildRunning || (model.status === "paused" && model.pausedReason === "building"))
    return "Available after the build completes";
  switch (model.status) {
    case "paused":
      return "Paused while hidden";
    case "loading":
      return "Loading failure history…";
    case "idle":
      return model.jobUrl ? "Not loaded" : "Loading failure history…";
    case "unavailable":
    case "error":
      return "Unavailable";
  }
  return undefined;
}

/** Live-region text. It only changes on state transitions, so re-posts are not re-announced. */
export function historyAnnouncement(model: HistoryViewModel): string {
  switch (model.status) {
    case "loading":
      return "Loading history";
    case "paused":
      return model.pausedReason === "building"
        ? "History is available after the build completes"
        : "Paused while panel is hidden";
    case "available":
    case "partial":
      return `Loaded ${model.builds.length} ${model.builds.length === 1 ? "build" : "builds"}`;
    case "unavailable":
      return "History unavailable";
    case "error":
      return "History failed to load";
    default:
      return "";
  }
}

interface FilterContext {
  model: HistoryViewModel;
  test: TestHistory;
  index: number;
}

const failsInSelected = ({ test, index }: FilterContext) => test.outcomes[index] === "failed";
const evidenceKind = ({ model, test }: FilterContext) => model.evidence[test.key]?.kind;

const FILTERS: Record<HistoryUiState["filter"], (context: FilterContext) => boolean> = {
  all: () => true,
  intermittent: ({ test }) => test.intermittent,
  failed: failsInSelected,
  new: (context) => evidenceKind(context) === "new",
  continuing: (context) => evidenceKind(context) === "continuing",
  baseline: (context) =>
    failsInSelected(context) && context.model.baselineOutcomes?.[context.test.key] === "failed"
};

function matchesSearch(test: TestHistory, search: string): boolean {
  return (
    !search ||
    `${test.name} ${test.className ?? ""} ${test.suiteName ?? ""}`.toLowerCase().includes(search)
  );
}

/** Tests failing in the selected build lead: new failures, then still failing, then the rest. */
function relevanceRank(model: HistoryViewModel, test: TestHistory, index: number): number {
  if (test.outcomes[index] !== "failed") return 3;
  const kind = model.evidence[test.key]?.kind;
  return kind === "new" ? 0 : kind === "continuing" ? 1 : 2;
}

/** Failure share of usable (passed or failed) observations; gaps never count as passes. */
export function failureRate(test: TestHistory): number | undefined {
  const usable = test.failed + test.passed;
  return usable ? test.failed / usable : undefined;
}

const SORTS: Record<
  HistorySort,
  (model: HistoryViewModel, index: number) => (a: TestHistory, b: TestHistory) => number
> = {
  // Within a rank, keep the analysis order (intermittent, transitions, failure rate).
  relevance: (model, index) => (a, b) =>
    relevanceRank(model, a, index) - relevanceRank(model, b, index),
  failureRate: () => (a, b) =>
    (failureRate(b) ?? -1) - (failureRate(a) ?? -1) || b.failed - a.failed,
  transitions: () => (a, b) => b.transitions - a.transitions,
  name: () => (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
};

export const HISTORY_SORT_LABELS: Record<HistorySort, string> = {
  relevance: "Failing in selected build first",
  failureRate: "Highest failure rate",
  transitions: "Most transitions",
  name: "Name"
};

export function filterTests(model: HistoryViewModel, ui: HistoryUiState): TestHistory[] {
  const index = selectedBuildIndex(model);
  const search = ui.search.toLowerCase();
  const matchesFilter = FILTERS[ui.filter] ?? FILTERS.all;
  const compare = (SORTS[ui.sort] ?? SORTS.relevance)(model, index);
  // Array.prototype.sort is stable, so ties keep the analysis order.
  return model.tests
    .filter((test) => matchesSearch(test, search) && matchesFilter({ model, test, index }))
    .sort(compare);
}

export const HISTORY_FILTER_LABELS: Record<HistoryUiState["filter"], string> = {
  all: "All tests",
  intermittent: "Intermittent",
  failed: "Failing in selected build",
  new: "New failures",
  continuing: "Still failing",
  baseline: "Also failing in baseline"
};

/** Builds whose whole test report is unavailable; every test has a gap there. */
export function unavailableReportBuilds(model: HistoryViewModel): number[] {
  return model.builds
    .filter((item) => item.report.status !== "available")
    .map((item) => item.build.number);
}

/**
 * Non-zero observation gaps for a test, most important first. Gaps that only come from a
 * build-level unavailable report are left to the table-level note, so they are not repeated
 * on every row; they still never count as passes.
 */
export function observationGaps(
  test: TestHistory,
  model: HistoryViewModel
): Array<{ label: string; emphasis: boolean; tooltip?: string }> {
  const testLevelUnavailable = test.outcomes.filter(
    (outcome, index) =>
      outcome === "unavailable" && model.builds[index]?.report.status === "available"
  ).length;
  const parts: Array<{ label: string; emphasis: boolean; count: number; tooltip?: string }> = [
    {
      count: test.ambiguous,
      label: "ambiguous",
      emphasis: true,
      tooltip: OUTCOMES.ambiguous.tooltip
    },
    {
      count: testLevelUnavailable,
      label: "unavailable",
      emphasis: true,
      tooltip: "Not in the sampled part of a partial test report."
    },
    {
      count: test.missing,
      label: "not reported",
      emphasis: true,
      tooltip: OUTCOMES.missing.tooltip
    },
    { count: test.unknown, label: "unknown", emphasis: false, tooltip: OUTCOMES.unknown.tooltip },
    { count: test.skipped, label: "skipped", emphasis: false }
  ];
  return parts
    .filter((part) => part.count > 0)
    .map(({ count, label, emphasis, tooltip }) => ({
      label: `${count} ${label}`,
      emphasis,
      tooltip
    }));
}

/** Absolute time formatted like Build Details' timestamps. */
export function formatHistoryTimestamp(timestamp: number | undefined): string {
  return typeof timestamp === "number" && timestamp > 0
    ? formatOptionalLocaleTimestamp(timestamp) || "—"
    : "—";
}

/**
 * Accessible name for a row's "Compare with #N" button. It starts with the visible text and
 * states the direction: within one job the older build is the baseline, as the controller orders it.
 */
export function compareBuildsLabel(rowBuild: number, selectedBuild: number): string {
  const baseline = Math.min(rowBuild, selectedBuild);
  const target = Math.max(rowBuild, selectedBuild);
  return `Compare with #${selectedBuild}: #${baseline} as baseline, #${target} as target`;
}

export function testIdentityLabel(test: {
  name: string;
  className?: string;
  suiteName?: string;
}): string {
  return [test.suiteName, test.className, test.name].filter(Boolean).join(" · ");
}
