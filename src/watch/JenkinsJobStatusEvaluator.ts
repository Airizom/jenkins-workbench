import {
  isRunningJobColor,
  resolveWatchStatusFromJobColor
} from "../formatters/JobColorFormatters";
import type { JenkinsBuildSummary } from "../jenkins/types";
import type { WatchedJobEntry, WatchStatusKind } from "../storage/JenkinsWatchStore";
import type { CompletionNotification } from "./StatusNotifier";
import { formatWatchJobLabel } from "./WatchJobLabelFormatter";

export interface JobStatusEvaluation {
  nextStatus: WatchStatusKind;
  shouldUpdateStatus: boolean;
  shouldUpdateCompletion: boolean;
  shouldUpdateBuilding: boolean;
  shouldRefresh: boolean;
  currentCompletedBuildNumber?: number;
  currentIsBuilding?: boolean;
  notification?:
    | { kind: "failure" | "recovery"; message: string }
    | { kind: "completion"; details: CompletionNotification };
}

export class JenkinsJobStatusEvaluator {
  evaluate(
    entry: WatchedJobEntry,
    jobName: string | undefined,
    color: string | undefined,
    lastCompletedBuild: JenkinsBuildSummary | undefined,
    environmentUrl: string
  ): JobStatusEvaluation {
    const currentStatus = resolveWatchStatusFromJobColor(color);
    const previousStatus = entry.lastStatus;
    const currentCompletedBuildNumber = lastCompletedBuild?.number;
    const previousCompletedBuildNumber = entry.lastCompletedBuildNumber;
    const currentIsBuilding = resolveBuildingFromJobColor(color);
    const previousIsBuilding = entry.lastIsBuilding;

    const shouldUpdateCompletion =
      typeof currentCompletedBuildNumber === "number" &&
      currentCompletedBuildNumber !== previousCompletedBuildNumber;
    const shouldUpdateBuilding =
      typeof currentIsBuilding === "boolean" && currentIsBuilding !== previousIsBuilding;
    const hasCompletionHistory =
      previousCompletedBuildNumber !== undefined || previousIsBuilding !== undefined;

    const notifiedFailure = shouldNotifyFailure(previousStatus, currentStatus);
    const notifiedRecovery = shouldNotifyRecovery(previousStatus, currentStatus);
    const notification: JobStatusEvaluation["notification"] = notifiedFailure
      ? {
          kind: "failure",
          message: `${formatWatchJobLabel(entry, jobName)} failed in ${environmentUrl}.`
        }
      : notifiedRecovery
        ? {
            kind: "recovery",
            message: `${formatWatchJobLabel(entry, jobName)} recovered in ${environmentUrl}.`
          }
        : shouldUpdateCompletion && hasCompletionHistory
          ? {
              kind: "completion",
              details: {
                jobLabel: formatWatchJobLabel(entry, jobName),
                environmentUrl,
                result: lastCompletedBuild?.result,
                color
              }
            }
          : undefined;

    const statusChanged = currentStatus !== "unknown" && currentStatus !== previousStatus;
    // Keep the last terminal status stored: an intervening "other" observation (e.g. a
    // running build) must not clobber a stored failure/success, or the next terminal
    // transition would skip its failure/recovery notification.
    const shouldUpdateStatus =
      statusChanged && !(currentStatus === "other" && isTerminalWatchStatus(previousStatus));
    const shouldRefresh = shouldUpdateStatus || shouldUpdateCompletion || shouldUpdateBuilding;

    return {
      nextStatus: currentStatus,
      shouldUpdateStatus,
      shouldUpdateCompletion,
      shouldUpdateBuilding,
      shouldRefresh,
      currentCompletedBuildNumber,
      currentIsBuilding,
      notification
    };
  }
}

function isTerminalWatchStatus(status: WatchStatusKind | undefined): boolean {
  return status === "success" || status === "failure";
}

function resolveBuildingFromJobColor(color?: string): boolean | undefined {
  if (!color) {
    return undefined;
  }
  return isRunningJobColor(color);
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
