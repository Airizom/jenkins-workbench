import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  formatCurrentBranchBuildDetailsLabel,
  formatCurrentBranchJobLabel
} from "./CurrentBranchPresentation";
import type { CurrentBranchRepositoryInfo, CurrentBranchState } from "./CurrentBranchTypes";

export type CurrentBranchUserMessage = {
  severity: "info" | "warning";
  message: string;
};

export type CurrentBranchResolutionResult =
  | {
      kind: "resolved";
      state: CurrentBranchState;
      message?: CurrentBranchUserMessage;
    }
  | {
      kind: "ambiguousRepository";
      repositories: CurrentBranchRepositoryInfo[];
    }
  | ({
      kind: "message";
    } & CurrentBranchUserMessage);

export type CurrentBranchJobActionTarget = {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
};

export type CurrentBranchBuildDetailsTarget = {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label: string;
};

export type CurrentBranchOpenRequest =
  | {
      kind: "openExternal";
      url: string;
      targetLabel: string;
    }
  | ({
      kind: "message";
    } & CurrentBranchUserMessage);

export type CurrentBranchBuildAction = "triggerBuild" | "openLatestBuild" | "openLastFailedBuild";

const GIT_UNAVAILABLE_MESSAGE = "Git integration is unavailable.";
const NO_ACTIVE_REPOSITORY_MESSAGE = "No Git repository is active in this window.";
const DETACHED_HEAD_MESSAGE = "Check out a branch to use current-branch Jenkins actions.";

export class CurrentBranchCommandMapper {
  mapStateToResolution(
    state: CurrentBranchState,
    repositories?: CurrentBranchRepositoryInfo[]
  ): CurrentBranchResolutionResult {
    switch (state.kind) {
      case "ambiguousRepository":
        return {
          kind: "ambiguousRepository",
          repositories: repositories ?? []
        };
      case "noGit":
        return {
          kind: "message",
          ...createInfoMessage(GIT_UNAVAILABLE_MESSAGE)
        };
      case "noRepository":
        return {
          kind: "message",
          ...createInfoMessage(NO_ACTIVE_REPOSITORY_MESSAGE)
        };
      case "unlinked":
        return {
          kind: "resolved",
          state,
          message: createInfoMessage("The active repository is not linked to Jenkins.")
        };
      case "detachedHead":
        return {
          kind: "message",
          ...createInfoMessage(DETACHED_HEAD_MESSAGE)
        };
      case "requestFailed":
        return {
          kind: "resolved",
          state,
          message: {
            severity: "warning",
            message: state.message
          }
        };
      default:
        return {
          kind: "resolved",
          state
        };
    }
  }

  getOpenBranchRequest(state: CurrentBranchState): CurrentBranchOpenRequest | undefined {
    if (state.kind === "matched") {
      return {
        kind: "openExternal",
        url: state.jobUrl,
        targetLabel:
          state.resolvedTargetKind === "pullRequest"
            ? "Jenkins pull request job URL"
            : "Jenkins branch job URL"
      };
    }

    if (state.kind === "branchMissing") {
      return {
        kind: "message",
        ...createInfoMessage(
          `Branch "${state.branchName}" was not found under ${state.link.multibranchLabel}.`
        )
      };
    }

    return undefined;
  }

  getOpenMultibranchRequest(state: CurrentBranchState): CurrentBranchOpenRequest | undefined {
    if (state.kind !== "branchMissing") {
      return undefined;
    }

    return {
      kind: "openExternal",
      url: state.link.multibranchFolderUrl,
      targetLabel: "Jenkins multibranch URL"
    };
  }

  getActionUnavailableMessage(
    state: CurrentBranchState,
    action: CurrentBranchBuildAction
  ): CurrentBranchUserMessage | undefined {
    switch (state.kind) {
      case "matched":
        // Only the latest-build action can lack a target for matched states.
        if (action !== "openLatestBuild" || state.lastBuild?.url) {
          return undefined;
        }
        return createInfoMessage(`No builds were found for "${state.jobName}" yet.`);
      case "branchMissing":
        return createInfoMessage(
          `No Jenkins job found for branch "${state.branchName}" under ${state.link.multibranchLabel}.`
        );
      case "unlinked":
      case "requestFailed":
        // mapStateToResolution already attaches a user message to these resolved states.
        return undefined;
      case "detachedHead":
        return createInfoMessage(DETACHED_HEAD_MESSAGE);
      case "noGit":
        return createInfoMessage(GIT_UNAVAILABLE_MESSAGE);
      case "noRepository":
      case "ambiguousRepository":
        return createInfoMessage(NO_ACTIVE_REPOSITORY_MESSAGE);
    }
  }

  getBuildTarget(state: CurrentBranchState): CurrentBranchJobActionTarget | undefined {
    if (state.kind !== "matched") {
      return undefined;
    }

    return this.toJobActionTarget(state);
  }

  getLatestBuildTarget(state: CurrentBranchState): CurrentBranchBuildDetailsTarget | undefined {
    if (state.kind !== "matched" || !state.lastBuild?.url) {
      return undefined;
    }

    return {
      environment: state.environment,
      buildUrl: state.lastBuild.url,
      label: formatCurrentBranchBuildDetailsLabel(state)
    };
  }

  getLastFailedBuildTarget(state: CurrentBranchState): CurrentBranchJobActionTarget | undefined {
    return this.getBuildTarget(state);
  }

  private toJobActionTarget(
    state: Extract<CurrentBranchState, { kind: "matched" }>
  ): CurrentBranchJobActionTarget {
    return {
      environment: state.environment,
      jobUrl: state.jobUrl,
      label: formatCurrentBranchJobLabel(state)
    };
  }
}

function createInfoMessage(message: string): CurrentBranchUserMessage {
  return {
    severity: "info",
    message
  };
}
