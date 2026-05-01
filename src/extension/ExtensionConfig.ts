import * as vscode from "vscode";
import { DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS } from "../currentBranch/CurrentBranchPullRequestJobPatterns";
import type { BuildListFetchOptions } from "../jenkins/JenkinsDataService";
import type { JenkinsfileIntelligenceConfig } from "../jenkinsfile/JenkinsfileIntelligenceTypes";
import type {
  BuildCompareOptions,
  BuildParameterRedactionOptions
} from "../panels/buildCompare/BuildCompareOptions";
import type { TreeActivityOptions } from "../tree/ActivityTypes";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { TreeViewCurationOptions } from "../tree/TreeViewCuration";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";

export const CONFIG_SECTION = "jenkinsWorkbench";

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS = 60;
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
const DEFAULT_BUILD_COMPARE_CONSOLE_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_BUILD_COMPARE_CONSOLE_MAX_LINES = 50_000;
const DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_VALUE = "[redacted]";
const DEFAULT_TREE_VIEW_CURATION_EXCLUDED_NAMES = ["all"];
const DEFAULT_ACTIVITY_MAX_ITEMS_PER_GROUP = 50;
const MAX_ACTIVITY_ITEMS_PER_GROUP = 100;
const MIN_ACTIVITY_SCAN_MAX_RESULTS = 100;
const DEFAULT_ACTIVITY_SCAN_MAX_RESULTS = 2000;
const MAX_ACTIVITY_SCAN_MAX_RESULTS = 10_000;
const MIN_ACTIVITY_JOB_SEARCH_BATCH_SIZE = 10;
const DEFAULT_ACTIVITY_JOB_SEARCH_BATCH_SIZE = 50;
const MAX_ACTIVITY_JOB_SEARCH_BATCH_SIZE = 200;
const MIN_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT = 0;
const DEFAULT_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT = 100;
const MAX_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT = 500;
const MIN_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY = 1;
const DEFAULT_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY = 4;
const MAX_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY = 10;
const MIN_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT = 1;
const DEFAULT_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT = 5;
const MAX_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT = 20;
const MIN_ACTIVITY_REFRESH_INTERVAL_SECONDS = 5;
const DEFAULT_ACTIVITY_REFRESH_INTERVAL_SECONDS = 60;
const MAX_ACTIVITY_REFRESH_INTERVAL_SECONDS = 3600;
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
const DEFAULT_JENKINSFILE_INTELLIGENCE_ENABLED = true;
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

export function getStatusRefreshIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const refreshIntervalSeconds = config.get<number>(
    "pollIntervalSeconds",
    DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS
  );
  return Number.isFinite(refreshIntervalSeconds)
    ? refreshIntervalSeconds
    : DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS;
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

export function getArtifactPreviewCacheMaxEntries(config: vscode.WorkspaceConfiguration): number {
  const value = config.get<number>(
    "artifactPreviewCacheMaxEntries",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES
  );
  if (!Number.isFinite(value)) {
    return DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES;
  }
  return Math.max(1, Math.floor(value));
}

export function getArtifactPreviewCacheMaxBytes(config: vscode.WorkspaceConfiguration): number {
  const value = config.get<number>(
    "artifactPreviewCacheMaxMb",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB
  );
  if (!Number.isFinite(value)) {
    return DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB * 1024 * 1024;
  }
  return Math.max(1, Math.floor(value)) * 1024 * 1024;
}

export function getArtifactPreviewCacheTtlMs(config: vscode.WorkspaceConfiguration): number {
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
  const parameterRedaction = getBuildParameterRedactionOptions(config);

  return {
    includeParameters,
    parameterAllowList: parameterRedaction.allowList,
    parameterDenyList: parameterRedaction.denyList,
    parameterMaskPatterns: parameterRedaction.maskPatterns,
    parameterMaskValue: parameterRedaction.maskValue
  };
}

export function getBuildParameterRedactionOptions(
  config: vscode.WorkspaceConfiguration
): BuildParameterRedactionOptions {
  const allowList = normalizeStringList(config.get<unknown>("buildTooltips.parameters.allowList"));
  const denyList = normalizeStringList(config.get<unknown>("buildTooltips.parameters.denyList"));
  const maskPatterns = normalizeStringList(
    config.get<unknown>(
      "buildTooltips.parameters.maskPatterns",
      DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_PATTERNS
    )
  );
  const maskValue =
    normalizeString(config.get<unknown>("buildTooltips.parameters.maskValue")) ??
    DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_VALUE;

  return {
    allowList,
    denyList,
    maskPatterns,
    maskValue
  };
}

export function getBuildCompareOptions(config: vscode.WorkspaceConfiguration): BuildCompareOptions {
  return {
    console: {
      maxBytes: getBoundedIntegerConfigValue(
        config,
        "buildCompare.console.maxBytes",
        DEFAULT_BUILD_COMPARE_CONSOLE_MAX_BYTES,
        1024
      ),
      maxLines: getBoundedIntegerConfigValue(
        config,
        "buildCompare.console.maxLines",
        DEFAULT_BUILD_COMPARE_CONSOLE_MAX_LINES,
        100
      )
    },
    parameterRedaction: getBuildParameterRedactionOptions(config)
  };
}

function getBoundedIntegerConfigValue(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: number,
  minimumValue: number
): number {
  const value = config.get<number>(key, defaultValue);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(minimumValue, Math.floor(value));
}

function getClampedIntegerConfigValue(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: number,
  minimumValue: number,
  maximumValue: number
): number {
  const value = config.get<number>(key, defaultValue);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.min(maximumValue, Math.max(minimumValue, Math.floor(value)));
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

export function getTreeViewCurationOptions(
  config: vscode.WorkspaceConfiguration
): TreeViewCurationOptions {
  const configuredValue = config.get<unknown>("treeViews.excludedNames");
  const excludedNames =
    typeof configuredValue === "undefined"
      ? DEFAULT_TREE_VIEW_CURATION_EXCLUDED_NAMES
      : normalizeStringList(configuredValue);
  return {
    excludedNames
  };
}

export function getTreeActivityOptions(config: vscode.WorkspaceConfiguration): TreeActivityOptions {
  const refreshIntervalSeconds = getClampedIntegerConfigValue(
    config,
    "activity.refreshIntervalSeconds",
    DEFAULT_ACTIVITY_REFRESH_INTERVAL_SECONDS,
    MIN_ACTIVITY_REFRESH_INTERVAL_SECONDS,
    MAX_ACTIVITY_REFRESH_INTERVAL_SECONDS
  );
  return {
    maxItemsPerGroup: getClampedIntegerConfigValue(
      config,
      "activity.maxItemsPerGroup",
      DEFAULT_ACTIVITY_MAX_ITEMS_PER_GROUP,
      1,
      MAX_ACTIVITY_ITEMS_PER_GROUP
    ),
    collection: {
      maxScanResults: getClampedIntegerConfigValue(
        config,
        "activity.maxScanResults",
        DEFAULT_ACTIVITY_SCAN_MAX_RESULTS,
        MIN_ACTIVITY_SCAN_MAX_RESULTS,
        MAX_ACTIVITY_SCAN_MAX_RESULTS
      ),
      jobSearchBatchSize: getClampedIntegerConfigValue(
        config,
        "activity.jobSearchBatchSize",
        DEFAULT_ACTIVITY_JOB_SEARCH_BATCH_SIZE,
        MIN_ACTIVITY_JOB_SEARCH_BATCH_SIZE,
        MAX_ACTIVITY_JOB_SEARCH_BATCH_SIZE
      ),
      pendingInputCandidateLimit: getClampedIntegerConfigValue(
        config,
        "activity.pendingInputCandidateLimit",
        DEFAULT_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT,
        MIN_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT,
        MAX_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT
      ),
      pendingInputLookupConcurrency: getClampedIntegerConfigValue(
        config,
        "activity.pendingInputLookupConcurrency",
        DEFAULT_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY,
        MIN_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY,
        MAX_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY
      ),
      pendingInputBuildLookupLimit: getClampedIntegerConfigValue(
        config,
        "activity.pendingInputBuildLookupLimit",
        DEFAULT_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT,
        MIN_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT,
        MAX_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT
      ),
      refreshMinIntervalMs: refreshIntervalSeconds * 1000
    }
  };
}

export function getCurrentBranchPullRequestJobNamePatterns(
  config: vscode.WorkspaceConfiguration
): string[] {
  const configuredValue = config.get<unknown>("currentBranch.pullRequestJobNamePatterns");
  const patterns =
    typeof configuredValue === "undefined"
      ? DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS
      : normalizeStringList(configuredValue);
  return [
    ...(patterns.length > 0 ? patterns : DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS)
  ];
}

export function getJenkinsfileValidationEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>("jenkinsfileValidation.enabled", DEFAULT_JENKINSFILE_VALIDATION_ENABLED)
  );
}

export function getJenkinsfileIntelligenceEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      "jenkinsfile.intelligence.enabled",
      DEFAULT_JENKINSFILE_INTELLIGENCE_ENABLED
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

export function getJenkinsfileIntelligenceConfig(
  config: vscode.WorkspaceConfiguration
): JenkinsfileIntelligenceConfig {
  return {
    enabled: getJenkinsfileIntelligenceEnabled(config)
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
