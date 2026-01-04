import type { JenkinsBuildSummary } from "../jenkins/types";
import type { WatchStatusKind, WatchedJobEntry } from "../storage/JenkinsWatchStore";
import type { StatusNotifier } from "./StatusNotifier";

export interface JobStatusEvaluation {
  nextStatus: WatchStatusKind;
  shouldUpdateStatus: boolean;
  shouldUpdateCompletion: boolean;
  shouldUpdateBuilding: boolean;
  shouldRefresh: boolean;
  currentCompletedBuildNumber?: number;
  currentIsBuilding?: boolean;
}

export class JenkinsJobStatusEvaluator {
  constructor(private readonly notifier: StatusNotifier) {}

  evaluate(
    entry: WatchedJobEntry,
    jobName: string | undefined,
    color: string | undefined,
    lastCompletedBuild: JenkinsBuildSummary | undefined,
    environmentUrl: string
  ): JobStatusEvaluation {
    const currentStatus = classifyJobStatus(color);
    const previousStatus = entry.lastStatus;
    const currentCompletedBuildNumber = lastCompletedBuild?.number;
    const previousCompletedBuildNumber = entry.lastCompletedBuildNumber;
    const currentIsBuilding = isBuildingColor(color);
    const previousIsBuilding = entry.lastIsBuilding;

    const buildNumberChanged =
      typeof currentCompletedBuildNumber === "number" &&
      currentCompletedBuildNumber !== previousCompletedBuildNumber;
    const hasCompletionHistory =
      previousCompletedBuildNumber !== undefined || previousIsBuilding !== undefined;
    const buildingChanged =
      previousIsBuilding !== undefined &&
      typeof currentIsBuilding === "boolean" &&
      previousIsBuilding !== currentIsBuilding;

    const notifiedFailure = shouldNotifyFailure(previousStatus, currentStatus);
    if (notifiedFailure) {
      this.notifier.notifyFailure(`${formatJobLabel(entry, jobName)} failed in ${environmentUrl}.`);
    }

    const notifiedRecovery = shouldNotifyRecovery(previousStatus, currentStatus);
    if (notifiedRecovery) {
      this.notifier.notifyRecovery(
        `${formatJobLabel(entry, jobName)} recovered in ${environmentUrl}.`
      );
    }

    if (buildNumberChanged && hasCompletionHistory && !notifiedFailure && !notifiedRecovery) {
      this.notifier.notifyCompletion({
        jobLabel: formatJobLabel(entry, jobName),
        environmentUrl,
        result: lastCompletedBuild?.result,
        color
      });
    }

    const shouldUpdateStatus = currentStatus !== "unknown" && currentStatus !== previousStatus;
    const shouldSeedCompletion =
      previousCompletedBuildNumber === undefined && typeof currentCompletedBuildNumber === "number";
    const shouldUpdateCompletion =
      typeof currentCompletedBuildNumber === "number" &&
      currentCompletedBuildNumber !== previousCompletedBuildNumber;
    const shouldSeedBuilding =
      previousIsBuilding === undefined && typeof currentIsBuilding === "boolean";
    const shouldUpdateBuilding =
      typeof currentIsBuilding === "boolean" && currentIsBuilding !== previousIsBuilding;
    const shouldRefresh =
      (shouldUpdateStatus && previousStatus !== undefined) ||
      (buildNumberChanged && hasCompletionHistory) ||
      buildingChanged;

    return {
      nextStatus: currentStatus,
      shouldUpdateStatus,
      shouldUpdateCompletion: shouldUpdateCompletion || shouldSeedCompletion,
      shouldUpdateBuilding: shouldUpdateBuilding || shouldSeedBuilding,
      shouldRefresh,
      currentCompletedBuildNumber,
      currentIsBuilding
    };
  }
}

function classifyJobStatus(color?: string): WatchStatusKind {
  const normalized = normalizeColor(color);
  if (!normalized) {
    return "unknown";
  }

  if (normalized === "red") {
    return "failure";
  }

  if (normalized === "blue" || normalized === "green") {
    return "success";
  }

  if (
    normalized === "yellow" ||
    normalized === "aborted" ||
    normalized === "disabled" ||
    normalized === "grey" ||
    normalized === "notbuilt"
  ) {
    return "other";
  }

  return "unknown";
}

function normalizeColor(color?: string): string | undefined {
  if (!color) {
    return undefined;
  }

  return color.toLowerCase().replace(/_anime$/, "");
}

function isBuildingColor(color?: string): boolean | undefined {
  if (!color) {
    return undefined;
  }

  return color.toLowerCase().endsWith("_anime");
}

function shouldNotifyFailure(
  previous: WatchStatusKind | undefined,
  current: WatchStatusKind
): boolean {
  if (!previous || previous === "unknown") {
    return false;
  }

  return current === "failure" && previous !== "failure";
}

function shouldNotifyRecovery(
  previous: WatchStatusKind | undefined,
  current: WatchStatusKind
): boolean {
  if (!previous || previous === "unknown") {
    return false;
  }

  return previous === "failure" && current === "success";
}

function formatJobLabel(entry: WatchedJobEntry, name?: string): string {
  const label = name ?? entry.jobName ?? entry.jobUrl;
  const kind = entry.jobKind === "pipeline" ? "Pipeline" : "Job";
  return `${kind} ${label}`;
}
