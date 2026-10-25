import * as vscode from "vscode";
import { isUriInside } from "../../currentBranch/CurrentBranchRepositoryUtils";
import type { CurrentBranchWorkflowService } from "../../currentBranch/CurrentBranchWorkflowService";
import { parseJobUrl } from "../../jenkins/urls";
import type { JenkinsJobSelection } from "../../ui/JenkinsJobPicker";

/** Resolve the source file's repository without prompting or consulting editor focus. */
export async function resolveLocalReplayJobSuggestion(
  sourceUri: vscode.Uri,
  workflow: CurrentBranchWorkflowService
): Promise<JenkinsJobSelection | undefined> {
  try {
    const repositories = (workflow.listRepositories() ?? [])
      .filter((repository) =>
        isUriInside(sourceUri, vscode.Uri.parse(repository.repositoryUriString))
      )
      .sort((left, right) => right.repositoryPath.length - left.repositoryPath.length);
    const repository = repositories[0];
    if (
      !repository ||
      repositories[1]?.repositoryPath.length === repository.repositoryPath.length
    ) {
      return undefined;
    }
    const resolution = await workflow.resolveCurrentBranchStateForRepository(repository, {
      force: true
    });
    if (resolution.kind !== "resolved" || resolution.state.kind !== "matched") {
      return undefined;
    }
    const state = resolution.state;
    const parsed = parseJobUrl(state.jobUrl, state.environment.url);
    return {
      environment: state.environment,
      entry: {
        name: state.jobName,
        fullName: parsed?.fullPath.join(" / ") ?? state.jobName,
        url: state.jobUrl,
        kind: "pipeline",
        color: state.jobColor,
        path: []
      }
    };
  } catch {
    // Suggestions are optional; a missing Git extension or Jenkins error must not block search.
    return undefined;
  }
}
