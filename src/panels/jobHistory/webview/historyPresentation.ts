import type { HistoryOutcome, TestHistory } from "../../../history/HistoryAnalysis";
import type { StatusVisualTone } from "../../shared/TestStatusStyles";
import type { HistoryUiState, HistoryViewModel } from "../shared/HistoryContracts";

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
    label: "Unavailable",
    tone: "neutral",
    gap: true,
    tooltip: "Not reported in this build."
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
  const counts = failureCounts(model);
  if (!counts.failing) return "No failing tests";
  return [
    `${counts.failing} failing`,
    counts.fresh ? `${counts.fresh} new` : "",
    counts.stillFailing ? `${counts.stillFailing} still failing` : "",
    counts.intermittent ? `${counts.intermittent} intermittent` : "",
    counts.baselineMatches ? `${counts.baselineMatches} also failing in baseline` : ""
  ]
    .filter(Boolean)
    .join(" · ");
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

export function filterTests(model: HistoryViewModel, ui: HistoryUiState): TestHistory[] {
  const index = selectedBuildIndex(model);
  const search = ui.search.toLowerCase();
  const matchesFilter = FILTERS[ui.filter] ?? FILTERS.all;
  return model.tests.filter(
    (test) => matchesSearch(test, search) && matchesFilter({ model, test, index })
  );
}

export const HISTORY_FILTER_LABELS: Record<HistoryUiState["filter"], string> = {
  all: "All tests",
  intermittent: "Intermittent",
  failed: "Failing in selected build",
  new: "New failures",
  continuing: "Still failing",
  baseline: "Also failing in baseline"
};

/** Non-zero observation gaps for a test, most important first. */
export function observationGaps(
  test: TestHistory
): Array<{ label: string; emphasis: boolean; tooltip?: string }> {
  const parts: Array<{ label: string; emphasis: boolean; count: number; tooltip?: string }> = [
    {
      count: test.ambiguous,
      label: "ambiguous",
      emphasis: true,
      tooltip: OUTCOMES.ambiguous.tooltip
    },
    {
      count: test.unavailable + test.errors,
      label: "unavailable",
      emphasis: true,
      tooltip: OUTCOMES.unavailable.tooltip
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

export function formatHistoryTimestamp(timestamp: number | undefined): string {
  return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toLocaleString()
    : "—";
}

export function testIdentityLabel(test: {
  name: string;
  className?: string;
  suiteName?: string;
}): string {
  return [test.suiteName, test.className, test.name].filter(Boolean).join(" · ");
}
