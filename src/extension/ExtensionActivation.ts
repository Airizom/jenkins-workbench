import * as vscode from "vscode";
import {
  CONFIG_SECTION,
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

  await activateRuntime(context, {
    cacheTtlMs: getCacheTtlMs(config),
    maxCacheEntries: getMaxCacheEntries(config),
    requestTimeoutMs: getRequestTimeoutMs(config),
    buildTooltipOptions: getBuildTooltipOptions(config),
    buildListFetchOptions: getBuildListFetchOptions(config),
    treeViewCurationOptions: getTreeViewCurationOptions(config),
    activityOptions: getTreeActivityOptions(config),
    artifactActionOptionsProvider: (workspaceFolder) =>
      getArtifactActionOptions(
        vscode.workspace.getConfiguration(CONFIG_SECTION, workspaceFolder.uri)
      ),
    artifactPreviewOptionsProvider: () => ({
      maxBytes: getArtifactMaxDownloadBytes(getExtensionConfiguration())
    }),
    artifactPreviewCacheOptions: {
      maxEntries: getArtifactPreviewCacheMaxEntries(config),
      maxTotalBytes: getArtifactPreviewCacheMaxBytes(config),
      ttlMs: getArtifactPreviewCacheTtlMs(config)
    },
    buildCompareOptionsProvider: () => getBuildCompareOptions(getExtensionConfiguration()),
    jenkinsfileIntelligenceConfig: getJenkinsfileIntelligenceConfig(config),
    jenkinsfileValidationConfig: getJenkinsfileValidationConfig(config),
    currentBranchPullRequestJobNamePatterns: getCurrentBranchPullRequestJobNamePatterns(config),
    extensionUri: context.extensionUri,
    statusRefreshIntervalSeconds: getStatusRefreshIntervalSeconds(config),
    watchErrorThreshold: getWatchErrorThreshold(config),
    queuePollIntervalSeconds: getQueuePollIntervalSeconds(config)
  });
}

export function deactivate(): void {
  // No-op for now.
}
