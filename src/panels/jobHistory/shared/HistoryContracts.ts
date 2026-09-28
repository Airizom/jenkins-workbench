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

export interface HistoryViewModel {
  type: "historyUpdate";
  revision: number;
  status: HistoryStatus;
  pausedReason?: HistoryPausedReason;
  jobUrl: string;
  count: 10 | 20 | 50;
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
export interface HistoryUiState {
  count: 10 | 20 | 50;
  search: string;
  filter: "all" | "intermittent" | "failed" | "new" | "continuing" | "baseline";
  selectedTest?: string;
  selectedBuild?: number;
}
export function normalizeHistoryUi(value: unknown): HistoryUiState {
  const state = isPlainRecord(value) ? value : {};
  return {
    count: state.count === 10 || state.count === 50 ? state.count : 20,
    search: typeof state.search === "string" ? state.search.slice(0, 1000) : "",
    filter:
      state.filter === "intermittent" ||
      state.filter === "failed" ||
      state.filter === "new" ||
      state.filter === "continuing" ||
      state.filter === "baseline"
        ? state.filter
        : "all",
    selectedTest: typeof state.selectedTest === "string" ? state.selectedTest : undefined,
    selectedBuild:
      typeof state.selectedBuild === "number" &&
      Number.isSafeInteger(state.selectedBuild) &&
      state.selectedBuild > 0
        ? state.selectedBuild
        : undefined
  };
}
export type HistoryAction = {
  type: "historyAction";
  revision: number;
  action:
    | "ready"
    | "refresh"
    | "window"
    | "selectBuild"
    | "openBuild"
    | "compare"
    | "baseline"
    | "resetBaseline"
    | "openJob"
    | "openJobInJenkins";
  value?: number;
};
export function isHistoryAction(value: unknown): value is HistoryAction {
  return (
    isPlainRecord(value) &&
    value.type === "historyAction" &&
    Number.isSafeInteger(value.revision) &&
    [
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
    ].includes(String(value.action)) &&
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

/** Human job name from its URL: folder segments joined with " / ", branch names decoded. */
export function historyJobDisplayName(jobUrl: string): string {
  const segments = parseJobUrl(jobUrl)?.fullPath;
  return segments?.length ? segments.map(decodeJenkinsJobName).join(" / ") : jobUrl;
}
