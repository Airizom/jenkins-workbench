import type {
  JenkinsTaskBuildDetails,
  JenkinsTaskRunnerBackend,
  JenkinsTaskRunnerOutput,
  JenkinsTaskRunRequest
} from "./JenkinsTaskRunnerContracts";
import { buildUrlFor, type QueueOwnership } from "./JenkinsTaskRunnerSupport";

export interface JenkinsTaskCleanupState {
  queueId: number;
  getBuildUrl(): string | undefined;
  setBuildUrl(buildUrl: string): void;
  getQueueOwnership(): QueueOwnership;
  updateQueueOwnership(details: JenkinsTaskBuildDetails): QueueOwnership;
}

export async function cleanupJenkinsTaskWork(
  backend: JenkinsTaskRunnerBackend,
  request: JenkinsTaskRunRequest,
  output: JenkinsTaskRunnerOutput,
  state: JenkinsTaskCleanupState
): Promise<void> {
  try {
    let buildUrl = state.getBuildUrl();
    if (!buildUrl) {
      try {
        const item = await backend.getQueueItem(request.environment, state.queueId);
        if (item.executable) {
          buildUrl = buildUrlFor(request.jobUrl, item.executable.number);
          state.setBuildUrl(buildUrl);
        }
      } catch {
        // The exact queue item may disappear while cancellation races with
        // execution. Without a build number there is no safe cleanup target.
      }
    }

    if (!buildUrl || !(await verifyExclusiveRunningBuild(backend, request, buildUrl, state))) {
      output.onCleanupError?.(
        "Jenkins queue ownership could not be verified; cleanup was skipped to avoid canceling shared work.",
        new Error("The queue item may include more than one trigger.")
      );
      return;
    }
    await backend.stopBuild(request.environment, buildUrl);
  } catch (error) {
    const message = `Failed to stop Jenkins build ${state.getBuildUrl()}; it may still be running.`;
    output.onCleanupError?.(message, error);
  }
}

async function verifyExclusiveRunningBuild(
  backend: JenkinsTaskRunnerBackend,
  request: JenkinsTaskRunRequest,
  buildUrl: string,
  state: JenkinsTaskCleanupState
): Promise<boolean> {
  if (state.getQueueOwnership() === "exclusive") {
    return true;
  }
  if (state.getQueueOwnership() !== "candidate") {
    return false;
  }
  try {
    const details = await backend.getBuildDetails(request.environment, buildUrl, {
      includeCauses: true
    });
    return state.updateQueueOwnership(details) === "exclusive";
  } catch {
    return false;
  }
}
