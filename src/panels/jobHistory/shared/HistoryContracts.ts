import type {
  FailureEvidence,
  HistoryBuild,
  HistoryOutcome,
  TestHistory
} from "../../../history/HistoryAnalysis";
import type { BaselineEvidence } from "../../../history/HistoryBaseline";
import { decodeJenkinsJobName } from "../../../jenkins/JenkinsJobNames";
import { parseJobUrl } from "../../../jenkins/urls";
import { isPlainRecord } from "../../../shared/runtimeGuards";

export const HISTORY_STATUSES = [
  "idle",
  "loading",
  "paused",
  "available",
  "partial",
  "unavailable",
  "error"
] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];
/** Why history is `paused`: the panel was hidden mid-load, or the anchor build is still running. */
export type HistoryPausedReason = "hidden" | "building";
export const HISTORY_WINDOW_SIZES = [10, 20, 50] as const;
export type HistoryWindowSize = (typeof HISTORY_WINDOW_SIZES)[number];
export function isHistoryWindowSize(value: unknown): value is HistoryWindowSize {
  return (HISTORY_WINDOW_SIZES as readonly unknown[]).includes(value);
}

export interface HistoryViewModel {
  type: "historyUpdate";
  revision: number;
  status: HistoryStatus;
  pausedReason?: HistoryPausedReason;
  jobUrl: string;
  /** Environment URL whose path is the Jenkins context path, used to name jobs. */
  environmentUrl?: string;
  count: HistoryWindowSize;
  builds: Array<{
    build: HistoryBuild["build"];
    report: { status: HistoryBuild["report"]["status"]; message?: string; truncated?: boolean };
  }>;
  tests: TestHistory[];
  evidence: Record<string, FailureEvidence>;
  selectedBuild?: number;
  baseline?: Omit<BaselineEvidence, "report">;
  baselineOutcomes?: Record<string, HistoryOutcome>;
  testsTruncated?: boolean;
  truncated?: boolean;
  message?: string;
}
export const HISTORY_SORTS = ["relevance", "failureRate", "transitions", "name"] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];
export const HISTORY_FILTERS = [
  "all",
  "intermittent",
  "failed",
  "new",
  "continuing",
  "baseline"
] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];
export interface HistoryUiState {
  count: HistoryWindowSize;
  search: string;
  filter: HistoryFilter;
  sort: HistorySort;
  /** Whether the embedded "Failure history" disclosure is expanded. */
  open: boolean;
  selectedTest?: string;
  selectedBuild?: number;
}
export function normalizeHistoryUi(value: unknown): HistoryUiState {
  const state = isPlainRecord(value) ? value : {};
  return {
    count: isHistoryWindowSize(state.count) ? state.count : 20,
    search: typeof state.search === "string" ? state.search.slice(0, 1000) : "",
    filter: (HISTORY_FILTERS as readonly unknown[]).includes(state.filter)
      ? (state.filter as HistoryFilter)
      : "all",
    sort: (HISTORY_SORTS as readonly unknown[]).includes(state.sort)
      ? (state.sort as HistorySort)
      : "relevance",
    open: state.open === true,
    selectedTest: typeof state.selectedTest === "string" ? state.selectedTest : undefined,
    selectedBuild:
      typeof state.selectedBuild === "number" &&
      Number.isSafeInteger(state.selectedBuild) &&
      state.selectedBuild > 0
        ? state.selectedBuild
        : undefined
  };
}
const HISTORY_ACTIONS = [
  "ready",
  "refresh",
  "window",
  "selectBuild",
  "openBuild",
  "compare",
  "baseline",
  "resetBaseline",
  "openJob",
  "openJobInJenkins"
] as const;
export type HistoryAction = {
  type: "historyAction";
  revision: number;
  action: (typeof HISTORY_ACTIONS)[number];
  value?: number;
};
export function isHistoryAction(value: unknown): value is HistoryAction {
  return (
    isPlainRecord(value) &&
    value.type === "historyAction" &&
    Number.isSafeInteger(value.revision) &&
    (HISTORY_ACTIONS as readonly string[]).includes(String(value.action)) &&
    (value.value === undefined ||
      (typeof value.value === "number" && Number.isSafeInteger(value.value)))
  );
}
export const emptyHistory = (): HistoryViewModel => ({
  type: "historyUpdate",
  revision: 0,
  status: "idle",
  jobUrl: "",
  count: 20,
  builds: [],
  tests: [],
  evidence: {}
});

/** Human job name from its URL: folder segments joined with " » " (as Jenkins does), branch names decoded. */
export function historyJobDisplayName(jobUrl: string, environmentUrl?: string): string {
  const segments = parseJobUrl(jobUrl, environmentUrl)?.fullPath;
  return segments?.length ? segments.map(decodeJenkinsJobName).join(" » ") : jobUrl;
}
