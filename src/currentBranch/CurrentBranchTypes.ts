import type * as vscode from "vscode";
import type { GitRepository } from "../git/GitExtensionApi";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsRepositoryLink } from "../storage/JenkinsRepositoryLinkStore";

export interface CurrentBranchRepositoryInfo {
  repositoryUriString: string;
  repositoryLabel: string;
  repositoryPath: string;
}

export interface CurrentBranchRepositoryContext extends CurrentBranchRepositoryInfo {
  repository: GitRepository;
  repositoryUri: vscode.Uri;
}

export interface CurrentBranchBuildInfo {
  url?: string;
  number?: number;
  result?: string;
  building?: boolean;
  timestamp?: number;
}

export interface CurrentBranchPullRequestInfo {
  number: number;
  title?: string;
  url?: string;
  headBranch?: string;
}

export type CurrentBranchTargetKind = "pullRequest" | "branch";

export interface CurrentBranchSelectedTargetInfo {
  kind: CurrentBranchTargetKind;
  jobName: string;
  jobUrl: string;
  jobColor?: string;
  pullRequest?: CurrentBranchPullRequestInfo;
}

type CurrentBranchBaseState = {
  repository?: CurrentBranchRepositoryInfo;
  branchName?: string;
};

export type CurrentBranchState =
  | (CurrentBranchBaseState & {
      kind: "noGit" | "noRepository" | "ambiguousRepository" | "unlinked";
    })
  | (CurrentBranchBaseState & {
      kind: "detachedHead";
      repository: CurrentBranchRepositoryInfo;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
    })
  | (CurrentBranchBaseState & {
      kind: "branchMissing";
      repository: CurrentBranchRepositoryInfo;
      branchName: string;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
    })
  | (CurrentBranchBaseState & {
      kind: "requestFailed";
      repository: CurrentBranchRepositoryInfo;
      branchName?: string;
      link?: JenkinsRepositoryLink;
      environment?: JenkinsEnvironmentRef;
      message: string;
      selectedTarget?: CurrentBranchSelectedTargetInfo;
    })
  | (CurrentBranchBaseState & {
      kind: "matched";
      repository: CurrentBranchRepositoryInfo;
      branchName: string;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
      resolvedTargetKind: CurrentBranchTargetKind;
      jobName: string;
      jobUrl: string;
      jobColor?: string;
      lastBuild?: CurrentBranchBuildInfo;
      pullRequest?: CurrentBranchPullRequestInfo;
    });

export interface CurrentBranchLinkedContext {
  kind: "linked";
  repository: CurrentBranchRepositoryContext;
  branchName: string;
  link: JenkinsRepositoryLink;
  environment: JenkinsEnvironmentRef;
}

type CurrentBranchRemoteStateKind = "branchMissing" | "requestFailed" | "matched";

type CurrentBranchRemoteResolvedRequirements = {
  branchName: string;
  link: JenkinsRepositoryLink;
  environment: JenkinsEnvironmentRef;
};

type CurrentBranchRemotePublicState = Extract<
  CurrentBranchState,
  { kind: CurrentBranchRemoteStateKind }
>;

export type CurrentBranchRemoteResolvedState = CurrentBranchRemotePublicState extends infer State
  ? State extends CurrentBranchRemotePublicState
    ? Omit<State, "repository" | keyof CurrentBranchRemoteResolvedRequirements> &
        CurrentBranchRemoteResolvedRequirements
    : never
  : never;

export type CurrentBranchRefreshOptions = {
  force?: boolean;
};
