import type * as vscode from "vscode";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import type { JenkinsfileIntelligenceConfig } from "../jenkinsfile/JenkinsfileIntelligenceTypes";
import type { BuildCompareOptions } from "../panels/buildCompare/BuildCompareOptions";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { TreeViewCurationOptions } from "../tree/TreeViewCuration";
import type { ArtifactActionOptionsProvider } from "../ui/ArtifactActionHandler";
import type { ArtifactPreviewProviderOptions } from "../ui/ArtifactPreviewProvider";
import type { ArtifactPreviewOptionsProvider } from "../ui/ArtifactPreviewer";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";
import {
  type ExtensionContainer,
  type ExtensionProviderCatalog,
  composeProviderCatalog,
  registerProviderCatalog
} from "./container/ExtensionContainer";
import { createCoreProviderCatalog } from "./providers/CoreProviders";
import { createRuntimeProviderCatalog } from "./providers/RuntimeProviders";
import { createTreeProviderCatalog } from "./providers/TreeProviders";
import { createValidationProviderCatalog } from "./providers/ValidationProviders";

export interface ExtensionServicesOptions {
  cacheTtlMs: number;
  maxCacheEntries: number;
  requestTimeoutMs: number;
  buildTooltipOptions: BuildTooltipOptions;
  buildListFetchOptions: BuildListFetchOptions;
  treeViewCurationOptions: TreeViewCurationOptions;
  artifactActionOptionsProvider: ArtifactActionOptionsProvider;
  artifactPreviewOptionsProvider: ArtifactPreviewOptionsProvider;
  artifactPreviewCacheOptions: ArtifactPreviewProviderOptions;
  buildCompareOptionsProvider: () => BuildCompareOptions;
  jenkinsfileIntelligenceConfig: JenkinsfileIntelligenceConfig;
  jenkinsfileValidationConfig: JenkinsfileValidationConfig;
}

export interface ExtensionRuntimeOptions extends ExtensionServicesOptions {
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
  const coreCatalog = createCoreProviderCatalog({
    context,
    cacheTtlMs: options.cacheTtlMs,
    maxCacheEntries: options.maxCacheEntries,
    requestTimeoutMs: options.requestTimeoutMs,
    artifactActionOptionsProvider: options.artifactActionOptionsProvider,
    artifactPreviewOptionsProvider: options.artifactPreviewOptionsProvider,
    artifactPreviewCacheOptions: options.artifactPreviewCacheOptions
  });

  const treeCatalog = createTreeProviderCatalog({
    buildTooltipOptions: options.buildTooltipOptions,
    buildListFetchOptions: options.buildListFetchOptions,
    treeViewCurationOptions: options.treeViewCurationOptions
  });

  const validationCatalog = createValidationProviderCatalog({
    context,
    jenkinsfileIntelligenceConfig: options.jenkinsfileIntelligenceConfig,
    jenkinsfileValidationConfig: options.jenkinsfileValidationConfig
  });

  const runtimeCatalog = createRuntimeProviderCatalog({
    extensionUri: options.extensionUri,
    buildCompareOptionsProvider: options.buildCompareOptionsProvider,
    currentBranchPullRequestJobNamePatterns: options.currentBranchPullRequestJobNamePatterns,
    statusRefreshIntervalSeconds: options.statusRefreshIntervalSeconds,
    watchErrorThreshold: options.watchErrorThreshold,
    queuePollIntervalSeconds: options.queuePollIntervalSeconds
  });

  const composedCatalog = composeProviderCatalog([
    coreCatalog,
    treeCatalog,
    validationCatalog,
    runtimeCatalog
  ]);
  registerProviderCatalog(container, composedCatalog as ExtensionProviderCatalog);
}
