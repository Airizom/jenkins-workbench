import type * as vscode from "vscode";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import type { JenkinsfileIntelligenceConfig } from "../jenkinsfile/JenkinsfileIntelligenceTypes";
import type { BuildCompareOptions } from "../panels/buildCompare/BuildCompareOptions";
import type { TreeActivityOptions } from "../tree/ActivityTypes";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { TreeViewCurationOptions } from "../tree/TreeViewCuration";
import type { ArtifactActionOptionsProvider } from "../ui/ArtifactActionHandler";
import type { ArtifactPreviewOptionsProvider } from "../ui/ArtifactPreviewer";
import type { ArtifactPreviewProviderOptions } from "../ui/ArtifactPreviewProvider";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";
import { type ExtensionContainer, registerProviderCatalogs } from "./container/ExtensionContainer";
import { createCoreProviderCatalog } from "./providers/CoreProviders";
import { createRuntimeProviderCatalog } from "./providers/RuntimeProviders";
import { createTreeProviderCatalog } from "./providers/TreeProviders";
import { createValidationProviderCatalog } from "./providers/ValidationProviders";

export interface ExtensionRuntimeOptions {
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  buildTooltipOptions: BuildTooltipOptions;
  buildListFetchOptions: BuildListFetchOptions;
  treeViewCurationOptions: TreeViewCurationOptions;
  activityOptions: TreeActivityOptions;
  artifactActionOptionsProvider: ArtifactActionOptionsProvider;
  artifactPreviewOptionsProvider: ArtifactPreviewOptionsProvider;
  artifactPreviewCacheOptions: ArtifactPreviewProviderOptions;
  buildCompareOptionsProvider: () => BuildCompareOptions;
  jenkinsfileIntelligenceConfig: JenkinsfileIntelligenceConfig;
  jenkinsfileValidationConfig: JenkinsfileValidationConfig;
  extensionUri: vscode.Uri;
  currentBranchPullRequestJobNamePatterns: readonly string[];
  statusRefreshIntervalSeconds: number;
  watchErrorThreshold: number;
  queuePollIntervalSeconds: number;
}

export function registerExtensionProviders(
  container: ExtensionContainer,
  context: vscode.ExtensionContext,
  options: ExtensionRuntimeOptions
): void {
  // Each catalog reads only the fields its own options type declares.
  const catalogOptions = { context, ...options };
  registerProviderCatalogs(container, [
    createCoreProviderCatalog(catalogOptions),
    createTreeProviderCatalog(catalogOptions),
    createValidationProviderCatalog(catalogOptions),
    createRuntimeProviderCatalog(catalogOptions)
  ]);
}
