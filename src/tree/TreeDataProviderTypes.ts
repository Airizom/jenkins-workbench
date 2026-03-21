import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { WorkbenchTreeElement } from "./TreeItems";
import type { TreeJobScope } from "./TreeJobScope";

export type TreeViewSummary = {
  running: number;
  queue: number;
  watchErrors: number;
  hasData: boolean;
};

export type TreeExpansionPath = string[];

export type TreeExpansionResolveResult = {
  element?: WorkbenchTreeElement;
  pending: boolean;
};

export interface TreeExpansionResolver {
  buildExpansionPath(element: WorkbenchTreeElement): Promise<TreeExpansionPath | undefined>;
  resolveExpansionPath(path: TreeExpansionPath): Promise<TreeExpansionResolveResult>;
  onDidChangeTreeData: vscode.Event<WorkbenchTreeElement | undefined>;
}

export type FullEnvironmentRefreshRequest = {
  environmentId?: string;
  trigger?: "manual" | "system";
  refreshToken?: number;
};

export type RefreshViewOnlyRequest = {
  clearDataCache?: boolean;
};

export type InvalidateBuildArtifactsRequest = {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  jobScope?: TreeJobScope;
  refreshTree?: boolean;
};
