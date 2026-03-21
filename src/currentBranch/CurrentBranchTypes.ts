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
    })
  | (CurrentBranchBaseState & {
      kind: "matched";
      repository: CurrentBranchRepositoryInfo;
      branchName: string;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
      jobName: string;
      jobUrl: string;
      jobColor?: string;
      lastBuild?: CurrentBranchBuildInfo;
    });

export interface CurrentBranchLinkedContext {
  kind: "linked";
  repository: CurrentBranchRepositoryContext;
  branchName: string;
  link: JenkinsRepositoryLink;
  environment: JenkinsEnvironmentRef;
}

export type CurrentBranchRemoteResolvedState =
  | {
      kind: "branchMissing";
      branchName: string;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
    }
  | {
      kind: "requestFailed";
      branchName: string;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
      message: string;
    }
  | {
      kind: "matched";
      branchName: string;
      link: JenkinsRepositoryLink;
      environment: JenkinsEnvironmentRef;
      jobName: string;
      jobUrl: string;
      jobColor?: string;
      lastBuild?: CurrentBranchBuildInfo;
    };

export type CurrentBranchRefreshOptions = {
  force?: boolean;
};
