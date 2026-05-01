import * as vscode from "vscode";
import {
  getArtifactActionOptions,
  getArtifactMaxDownloadBytes,
  getArtifactPreviewCacheMaxBytes,
  getArtifactPreviewCacheMaxEntries,
  getArtifactPreviewCacheTtlMs,
  getBuildCompareOptions,
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getCurrentBranchPullRequestJobNamePatterns,
  getExtensionConfiguration,
  getJenkinsfileIntelligenceConfig,
  getJenkinsfileValidationConfig,
  getMaxCacheEntries,
  getQueuePollIntervalSeconds,
  getRequestTimeoutMs,
  getStatusRefreshIntervalSeconds,
  getTreeActivityOptions,
  getTreeViewCurationOptions,
  getWatchErrorThreshold
} from "./ExtensionConfig";
import { activateRuntime } from "./ExtensionRuntime";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = getExtensionConfiguration();
  const cacheTtlMs = getCacheTtlMs(config);
  const statusRefreshIntervalSeconds = getStatusRefreshIntervalSeconds(config);
  const watchErrorThreshold = getWatchErrorThreshold(config);
  const queuePollIntervalSeconds = getQueuePollIntervalSeconds(config);
  const maxCacheEntries = getMaxCacheEntries(config);
  const requestTimeoutMs = getRequestTimeoutMs(config);
  const buildTooltipOptions = getBuildTooltipOptions(config);
  const buildListFetchOptions = getBuildListFetchOptions(config);
  const treeViewCurationOptions = getTreeViewCurationOptions(config);
  const activityOptions = getTreeActivityOptions(config);
  const artifactPreviewCacheMaxEntries = getArtifactPreviewCacheMaxEntries(config);
  const artifactPreviewCacheMaxBytes = getArtifactPreviewCacheMaxBytes(config);
  const artifactPreviewCacheTtlMs = getArtifactPreviewCacheTtlMs(config);
  const currentBranchPullRequestJobNamePatterns =
    getCurrentBranchPullRequestJobNamePatterns(config);
  const jenkinsfileIntelligenceConfig = getJenkinsfileIntelligenceConfig(config);
  const jenkinsfileValidationConfig = getJenkinsfileValidationConfig(config);
  const artifactActionOptionsProvider = (
    workspaceFolder: vscode.WorkspaceFolder
  ): { downloadRoot: string; maxBytes?: number } => {
    const folderConfig = vscode.workspace.getConfiguration("jenkinsWorkbench", workspaceFolder.uri);
    return getArtifactActionOptions(folderConfig);
  };
  const artifactPreviewOptionsProvider = (): { maxBytes?: number } => {
    const previewConfig = getExtensionConfiguration();
    return { maxBytes: getArtifactMaxDownloadBytes(previewConfig) };
  };
  const buildCompareOptionsProvider = () => getBuildCompareOptions(getExtensionConfiguration());

  await activateRuntime(context, {
    cacheTtlMs,
    maxCacheEntries,
    requestTimeoutMs,
    buildTooltipOptions,
    buildListFetchOptions,
    treeViewCurationOptions,
    activityOptions,
    artifactActionOptionsProvider,
    artifactPreviewOptionsProvider,
    artifactPreviewCacheOptions: {
      maxEntries: artifactPreviewCacheMaxEntries,
      maxTotalBytes: artifactPreviewCacheMaxBytes,
      ttlMs: artifactPreviewCacheTtlMs
    },
    buildCompareOptionsProvider,
    jenkinsfileIntelligenceConfig,
    jenkinsfileValidationConfig,
    currentBranchPullRequestJobNamePatterns,
    extensionUri: context.extensionUri,
    statusRefreshIntervalSeconds,
    watchErrorThreshold,
    queuePollIntervalSeconds
  });
}

export function deactivate(): void {
  // No-op for now.
}
