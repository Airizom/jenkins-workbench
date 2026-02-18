import * as vscode from "vscode";
import {
  getArtifactActionOptions,
  getArtifactMaxDownloadBytes,
  getArtifactPreviewCacheMaxBytes,
  getArtifactPreviewCacheMaxEntries,
  getArtifactPreviewCacheTtlMs,
  getBuildListFetchOptions,
  getBuildTooltipOptions,
  getCacheTtlMs,
  getExtensionConfiguration,
  getJenkinsfileValidationConfig,
  getMaxCacheEntries,
  getPollIntervalSeconds,
  getQueuePollIntervalSeconds,
  getRequestTimeoutMs,
  getWatchErrorThreshold
} from "./ExtensionConfig";
import { activateRuntime } from "./ExtensionRuntime";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = getExtensionConfiguration();
  const cacheTtlMs = getCacheTtlMs(config);
  const pollIntervalSeconds = getPollIntervalSeconds(config);
  const watchErrorThreshold = getWatchErrorThreshold(config);
  const queuePollIntervalSeconds = getQueuePollIntervalSeconds(config);
  const maxCacheEntries = getMaxCacheEntries(config);
  const requestTimeoutMs = getRequestTimeoutMs(config);
  const buildTooltipOptions = getBuildTooltipOptions(config);
  const buildListFetchOptions = getBuildListFetchOptions(config);
  const artifactPreviewCacheMaxEntries = getArtifactPreviewCacheMaxEntries(config);
  const artifactPreviewCacheMaxBytes = getArtifactPreviewCacheMaxBytes(config);
  const artifactPreviewCacheTtlMs = getArtifactPreviewCacheTtlMs(config);
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

  await activateRuntime(context, {
    cacheTtlMs,
    maxCacheEntries,
    requestTimeoutMs,
    buildTooltipOptions,
    buildListFetchOptions,
    artifactActionOptionsProvider,
    artifactPreviewOptionsProvider,
    artifactPreviewCacheOptions: {
      maxEntries: artifactPreviewCacheMaxEntries,
      maxTotalBytes: artifactPreviewCacheMaxBytes,
      ttlMs: artifactPreviewCacheTtlMs
    },
    jenkinsfileValidationConfig,
    extensionUri: context.extensionUri,
    pollIntervalSeconds,
    watchErrorThreshold,
    queuePollIntervalSeconds
  });
}

export function deactivate(): void {
  // No-op for now.
}
