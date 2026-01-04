import * as vscode from "vscode";

export const CONFIG_SECTION = "jenkinsWorkbench";

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const DEFAULT_WATCH_ERROR_THRESHOLD = 3;
const DEFAULT_QUEUE_POLL_INTERVAL_SECONDS = 10;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_CACHE_ENTRIES = 1000;

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function buildConfigKey(key: string): string {
  return `${CONFIG_SECTION}.${key}`;
}

export function getCacheTtlMs(config: vscode.WorkspaceConfiguration): number {
  const cacheTtlSeconds = config.get<number>("cacheTtlSeconds", DEFAULT_CACHE_TTL_SECONDS);
  return Number.isFinite(cacheTtlSeconds)
    ? Math.max(0, cacheTtlSeconds) * 1000
    : DEFAULT_CACHE_TTL_SECONDS * 1000;
}

export function getPollIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const pollIntervalSeconds = config.get<number>(
    "pollIntervalSeconds",
    DEFAULT_POLL_INTERVAL_SECONDS
  );
  return Number.isFinite(pollIntervalSeconds) ? pollIntervalSeconds : DEFAULT_POLL_INTERVAL_SECONDS;
}

export function getWatchErrorThreshold(config: vscode.WorkspaceConfiguration): number {
  const watchErrorThreshold = config.get<number>(
    "watchErrorThreshold",
    DEFAULT_WATCH_ERROR_THRESHOLD
  );
  return Number.isFinite(watchErrorThreshold) ? watchErrorThreshold : DEFAULT_WATCH_ERROR_THRESHOLD;
}

export function getQueuePollIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const pollIntervalSeconds = config.get<number>(
    "queuePollIntervalSeconds",
    DEFAULT_QUEUE_POLL_INTERVAL_SECONDS
  );
  return Number.isFinite(pollIntervalSeconds)
    ? pollIntervalSeconds
    : DEFAULT_QUEUE_POLL_INTERVAL_SECONDS;
}

export function getRequestTimeoutMs(config: vscode.WorkspaceConfiguration): number {
  const timeoutSeconds = config.get<number>(
    "requestTimeoutSeconds",
    DEFAULT_REQUEST_TIMEOUT_SECONDS
  );
  const resolved = Number.isFinite(timeoutSeconds)
    ? Math.max(5, timeoutSeconds)
    : DEFAULT_REQUEST_TIMEOUT_SECONDS;
  return resolved * 1000;
}

export function getMaxCacheEntries(config: vscode.WorkspaceConfiguration): number {
  const maxEntries = config.get<number>("maxCacheEntries", DEFAULT_MAX_CACHE_ENTRIES);
  return Number.isFinite(maxEntries) ? Math.max(100, maxEntries) : DEFAULT_MAX_CACHE_ENTRIES;
}
