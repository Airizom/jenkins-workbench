import * as vscode from "vscode";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";

export const CONFIG_SECTION = "jenkinsWorkbench";

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const DEFAULT_WATCH_ERROR_THRESHOLD = 3;
const DEFAULT_QUEUE_POLL_INTERVAL_SECONDS = 10;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_CACHE_ENTRIES = 1000;
const DEFAULT_BUILD_TOOLTIP_DETAILS = false;
const DEFAULT_BUILD_TOOLTIP_PARAMETERS_ENABLED = false;
const DEFAULT_ARTIFACT_DOWNLOAD_ROOT = "jenkins-artifacts";
const DEFAULT_ARTIFACT_MAX_DOWNLOAD_MB = 100;
const DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES = 50;
const DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB = 200;
const DEFAULT_ARTIFACT_PREVIEW_CACHE_TTL_SECONDS = 900;
const DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_VALUE = "[redacted]";
const DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_PATTERNS = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "credential",
  "passphrase"
];
const DEFAULT_JENKINSFILE_VALIDATION_ENABLED = true;
const DEFAULT_JENKINSFILE_VALIDATION_RUN_ON_SAVE = true;
const DEFAULT_JENKINSFILE_VALIDATION_DEBOUNCE_MS = 500;
const DEFAULT_JENKINSFILE_VALIDATION_FILE_PATTERNS = [
  "**/Jenkinsfile",
  "**/*.jenkinsfile",
  "**/Jenkinsfile.*"
];

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

export function getBuildTooltipDetailsEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>("buildTooltips.includeDetails", DEFAULT_BUILD_TOOLTIP_DETAILS)
  );
}

export function getBuildTooltipParametersEnabled(config: vscode.WorkspaceConfiguration): boolean {
  const includeParameters = config.get<boolean>(
    "buildTooltips.parameters.enabled",
    DEFAULT_BUILD_TOOLTIP_PARAMETERS_ENABLED
  );
  return Boolean(includeParameters);
}

export function getArtifactDownloadRoot(config: vscode.WorkspaceConfiguration): string {
  return (
    normalizeString(config.get<unknown>("artifactDownloadRoot")) ?? DEFAULT_ARTIFACT_DOWNLOAD_ROOT
  );
}

export function getArtifactActionOptions(config: vscode.WorkspaceConfiguration): {
  downloadRoot: string;
  maxBytes?: number;
} {
  return {
    downloadRoot: getArtifactDownloadRoot(config),
    maxBytes: getArtifactMaxDownloadBytes(config)
  };
}

export function getArtifactMaxDownloadBytes(
  config: vscode.WorkspaceConfiguration
): number | undefined {
  const value = config.get<number>("artifactMaxDownloadMb", DEFAULT_ARTIFACT_MAX_DOWNLOAD_MB);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value) * 1024 * 1024;
}

export function getArtifactPreviewCacheMaxEntries(
  config: vscode.WorkspaceConfiguration
): number {
  const value = config.get<number>(
    "artifactPreviewCacheMaxEntries",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES
  );
  if (!Number.isFinite(value)) {
    return DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES;
  }
  return Math.max(1, Math.floor(value));
}

export function getArtifactPreviewCacheMaxBytes(
  config: vscode.WorkspaceConfiguration
): number {
  const value = config.get<number>(
    "artifactPreviewCacheMaxMb",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB
  );
  if (!Number.isFinite(value)) {
    return DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB * 1024 * 1024;
  }
  return Math.max(1, Math.floor(value)) * 1024 * 1024;
}

export function getArtifactPreviewCacheTtlMs(
  config: vscode.WorkspaceConfiguration
): number {
  const value = config.get<number>(
    "artifactPreviewCacheTtlSeconds",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_TTL_SECONDS
  );
  if (!Number.isFinite(value)) {
    return DEFAULT_ARTIFACT_PREVIEW_CACHE_TTL_SECONDS * 1000;
  }
  return Math.max(1, Math.floor(value)) * 1000;
}

export function getBuildTooltipOptions(config: vscode.WorkspaceConfiguration): BuildTooltipOptions {
  const includeParameters = getBuildTooltipParametersEnabled(config);
  const parameterAllowList = normalizeStringList(
    config.get<unknown>("buildTooltips.parameters.allowList")
  );
  const parameterDenyList = normalizeStringList(
    config.get<unknown>("buildTooltips.parameters.denyList")
  );
  const parameterMaskPatterns = normalizeStringList(
    config.get<unknown>(
      "buildTooltips.parameters.maskPatterns",
      DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_PATTERNS
    )
  );
  const parameterMaskValue =
    normalizeString(config.get<unknown>("buildTooltips.parameters.maskValue")) ??
    DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_VALUE;

  return {
    includeParameters,
    parameterAllowList,
    parameterDenyList,
    parameterMaskPatterns,
    parameterMaskValue
  };
}

export function getBuildListFetchOptions(
  config: vscode.WorkspaceConfiguration
): BuildListFetchOptions {
  const includeDetails = getBuildTooltipDetailsEnabled(config);
  return {
    detailLevel: includeDetails ? "details" : "summary",
    includeParameters: getBuildTooltipParametersEnabled(config)
  };
}

export function getJenkinsfileValidationEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      "jenkinsfileValidation.enabled",
      DEFAULT_JENKINSFILE_VALIDATION_ENABLED
    )
  );
}

export function getJenkinsfileValidationRunOnSave(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      "jenkinsfileValidation.runOnSave",
      DEFAULT_JENKINSFILE_VALIDATION_RUN_ON_SAVE
    )
  );
}

export function getJenkinsfileValidationChangeDebounceMs(
  config: vscode.WorkspaceConfiguration
): number {
  const value = config.get<number>(
    "jenkinsfileValidation.changeDebounceMs",
    DEFAULT_JENKINSFILE_VALIDATION_DEBOUNCE_MS
  );
  if (!Number.isFinite(value)) {
    return DEFAULT_JENKINSFILE_VALIDATION_DEBOUNCE_MS;
  }
  return Math.max(0, Math.floor(value));
}

export function getJenkinsfileValidationFilePatterns(
  config: vscode.WorkspaceConfiguration
): string[] {
  const value = config.get<unknown>(
    "jenkinsfileValidation.filePatterns",
    DEFAULT_JENKINSFILE_VALIDATION_FILE_PATTERNS
  );
  const patterns = normalizeStringList(value);
  return patterns.length > 0 ? patterns : DEFAULT_JENKINSFILE_VALIDATION_FILE_PATTERNS;
}

export function getJenkinsfileValidationConfig(
  config: vscode.WorkspaceConfiguration
): JenkinsfileValidationConfig {
  return {
    enabled: getJenkinsfileValidationEnabled(config),
    runOnSave: getJenkinsfileValidationRunOnSave(config),
    changeDebounceMs: getJenkinsfileValidationChangeDebounceMs(config),
    filePatterns: getJenkinsfileValidationFilePatterns(config)
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item));
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
