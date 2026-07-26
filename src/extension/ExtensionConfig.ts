import * as vscode from "vscode";
import { DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS } from "../currentBranch/CurrentBranchPullRequestJobPatterns";
import type { BuildListFetchOptions, JobSearchOptions } from "../jenkins/JenkinsDataService";
import type { JenkinsfileIntelligenceConfig } from "../jenkinsfile/JenkinsfileIntelligenceTypes";
import type {
  BuildCompareOptions,
  BuildParameterRedactionOptions
} from "../panels/buildCompare/BuildCompareOptions";
import { trimToUndefined } from "../shared/stringValues";
import type { TreeActivityOptions } from "../tree/ActivityTypes";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { TreeViewCurationOptions } from "../tree/TreeViewCuration";
import type { JenkinsfileValidationConfig } from "../validation/JenkinsfileValidationTypes";

export const CONFIG_SECTION = "jenkinsWorkbench";

export const CONFIG_KEYS = {
  cacheTtlSeconds: "cacheTtlSeconds",
  statusRefreshIntervalSeconds: "pollIntervalSeconds",
  watchErrorThreshold: "watchErrorThreshold",
  queuePollIntervalSeconds: "queuePollIntervalSeconds",
  taskRunnerPollIntervalSeconds: "taskRunner.pollIntervalSeconds",
  taskRunnerMaxConsecutiveErrors: "taskRunner.maxConsecutiveErrors",
  currentBranchPullRequestJobNamePatterns: "currentBranch.pullRequestJobNamePatterns",
  buildTooltipDetails: "buildTooltips.includeDetails",
  buildTooltipParametersEnabled: "buildTooltips.parameters.enabled",
  buildTooltipParametersAllowList: "buildTooltips.parameters.allowList",
  buildTooltipParametersDenyList: "buildTooltips.parameters.denyList",
  buildTooltipParametersMaskPatterns: "buildTooltips.parameters.maskPatterns",
  buildTooltipParametersMaskValue: "buildTooltips.parameters.maskValue",
  treeViewsExcludedNames: "treeViews.excludedNames",
  activityMaxItemsPerGroup: "activity.maxItemsPerGroup",
  activityMaxScanResults: "activity.maxScanResults",
  activityJobSearchBatchSize: "activity.jobSearchBatchSize",
  activityPendingInputCandidateLimit: "activity.pendingInputCandidateLimit",
  activityPendingInputLookupConcurrency: "activity.pendingInputLookupConcurrency",
  activityPendingInputBuildLookupLimit: "activity.pendingInputBuildLookupLimit",
  activityRefreshIntervalSeconds: "activity.refreshIntervalSeconds",
  jenkinsfileValidationEnabled: "jenkinsfileValidation.enabled",
  jenkinsfileValidationRunOnSave: "jenkinsfileValidation.runOnSave",
  jenkinsfileValidationChangeDebounce: "jenkinsfileValidation.changeDebounceMs",
  jenkinsfileValidationFilePatterns: "jenkinsfileValidation.filePatterns",
  jenkinsfileIntelligenceEnabled: "jenkinsfile.intelligence.enabled"
} as const;

export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS = 60;
const MIN_STATUS_REFRESH_INTERVAL_SECONDS = 5;
const DEFAULT_WATCH_ERROR_THRESHOLD = 3;
const DEFAULT_QUEUE_POLL_INTERVAL_SECONDS = 10;
const MIN_QUEUE_POLL_INTERVAL_SECONDS = 2;
const DEFAULT_TASK_RUNNER_POLL_INTERVAL_SECONDS = 2;
const MIN_TASK_RUNNER_POLL_INTERVAL_SECONDS = 1;
const DEFAULT_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS = 5;
const MIN_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS = 1;
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_CACHE_ENTRIES = 1000;
const MAX_CACHE_ENTRIES = 100_000;
const DEFAULT_BUILD_TOOLTIP_DETAILS = false;
const DEFAULT_BUILD_TOOLTIP_PARAMETERS_ENABLED = false;
const DEFAULT_ARTIFACT_DOWNLOAD_ROOT = "jenkins-artifacts";
const DEFAULT_ARTIFACT_MAX_DOWNLOAD_MB = 100;
const DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES = 50;
const MAX_ARTIFACT_PREVIEW_CACHE_ENTRIES = 1000;
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

function getFiniteNumberConfigValue(
  config: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: number
): number {
  const value = config.get<number>(key, defaultValue);
  return Number.isFinite(value) ? value : defaultValue;
}

export function getCacheTtlMs(config: vscode.WorkspaceConfiguration): number {
  const cacheTtlSeconds = getFiniteNumberConfigValue(
    config,
    CONFIG_KEYS.cacheTtlSeconds,
    DEFAULT_CACHE_TTL_SECONDS
  );
  return Math.max(0, cacheTtlSeconds) * 1000;
}

export function getStatusRefreshIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const refreshIntervalSeconds = getFiniteNumberConfigValue(
    config,
    CONFIG_KEYS.statusRefreshIntervalSeconds,
    DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS
  );
  return Math.max(MIN_STATUS_REFRESH_INTERVAL_SECONDS, refreshIntervalSeconds);
}

export function getWatchErrorThreshold(config: vscode.WorkspaceConfiguration): number {
  return getFiniteNumberConfigValue(
    config,
    CONFIG_KEYS.watchErrorThreshold,
    DEFAULT_WATCH_ERROR_THRESHOLD
  );
}

export function getQueuePollIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const pollIntervalSeconds = getFiniteNumberConfigValue(
    config,
    CONFIG_KEYS.queuePollIntervalSeconds,
    DEFAULT_QUEUE_POLL_INTERVAL_SECONDS
  );
  return Math.max(MIN_QUEUE_POLL_INTERVAL_SECONDS, pollIntervalSeconds);
}

export function getJenkinsTaskRunnerOptions(
  config: vscode.WorkspaceConfiguration = getExtensionConfiguration()
): {
  pollIntervalMs: number;
  maxConsecutiveErrors: number;
} {
  const pollIntervalSeconds = getFiniteNumberConfigValue(
    config,
    CONFIG_KEYS.taskRunnerPollIntervalSeconds,
    DEFAULT_TASK_RUNNER_POLL_INTERVAL_SECONDS
  );
  return {
    pollIntervalMs: Math.max(MIN_TASK_RUNNER_POLL_INTERVAL_SECONDS, pollIntervalSeconds) * 1000,
    maxConsecutiveErrors: getBoundedIntegerConfigValue(
      config,
      CONFIG_KEYS.taskRunnerMaxConsecutiveErrors,
      DEFAULT_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS,
      MIN_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS
    )
  };
}

export function getRequestTimeoutMs(config: vscode.WorkspaceConfiguration): number {
  const timeoutSeconds = getFiniteNumberConfigValue(
    config,
    "requestTimeoutSeconds",
    DEFAULT_REQUEST_TIMEOUT_SECONDS
  );
  return Math.max(5, timeoutSeconds) * 1000;
}

export function getMaxCacheEntries(config: vscode.WorkspaceConfiguration): number {
  return getClampedIntegerConfigValue(
    config,
    "maxCacheEntries",
    DEFAULT_MAX_CACHE_ENTRIES,
    100,
    MAX_CACHE_ENTRIES
  );
}

function getBuildTooltipDetailsEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(CONFIG_KEYS.buildTooltipDetails, DEFAULT_BUILD_TOOLTIP_DETAILS)
  );
}

function getBuildTooltipParametersEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      CONFIG_KEYS.buildTooltipParametersEnabled,
      DEFAULT_BUILD_TOOLTIP_PARAMETERS_ENABLED
    )
  );
}

function getArtifactDownloadRoot(config: vscode.WorkspaceConfiguration): string {
  const configuredRoot = config.get<unknown>("artifactDownloadRoot");
  return typeof configuredRoot === "string" && configuredRoot.trim()
    ? configuredRoot
    : DEFAULT_ARTIFACT_DOWNLOAD_ROOT;
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
  return Math.floor(value * 1024 * 1024);
}

export function getArtifactPreviewCacheMaxEntries(config: vscode.WorkspaceConfiguration): number {
  return getClampedIntegerConfigValue(
    config,
    "artifactPreviewCacheMaxEntries",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES,
    1,
    MAX_ARTIFACT_PREVIEW_CACHE_ENTRIES
  );
}

export function getArtifactPreviewCacheMaxBytes(config: vscode.WorkspaceConfiguration): number {
  const maxMegabytes = getBoundedIntegerConfigValue(
    config,
    "artifactPreviewCacheMaxMb",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB,
    1
  );
  return maxMegabytes * 1024 * 1024;
}

export function getArtifactPreviewCacheTtlMs(config: vscode.WorkspaceConfiguration): number {
  const ttlSeconds = getBoundedIntegerConfigValue(
    config,
    "artifactPreviewCacheTtlSeconds",
    DEFAULT_ARTIFACT_PREVIEW_CACHE_TTL_SECONDS,
    1
  );
  return ttlSeconds * 1000;
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

function getBuildParameterRedactionOptions(
  config: vscode.WorkspaceConfiguration
): BuildParameterRedactionOptions {
  const allowList = normalizeStringList(
    config.get<unknown>(CONFIG_KEYS.buildTooltipParametersAllowList)
  );
  const denyList = normalizeStringList(
    config.get<unknown>(CONFIG_KEYS.buildTooltipParametersDenyList)
  );
  const maskPatterns = normalizeStringList(
    config.get<unknown>(
      CONFIG_KEYS.buildTooltipParametersMaskPatterns,
      DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_PATTERNS
    )
  );
  const maskValue =
    trimToUndefined(config.get<unknown>(CONFIG_KEYS.buildTooltipParametersMaskValue)) ??
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
  if (!Number.isFinite(value)) {
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
  if (!Number.isFinite(value)) {
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

export function getJobSearchTuningOptions(config: vscode.WorkspaceConfiguration): JobSearchOptions {
  return {
    concurrency: config.get<number>("jobSearchConcurrency"),
    backoffBaseMs: config.get<number>("jobSearchBackoffBaseMs"),
    backoffMaxMs: config.get<number>("jobSearchBackoffMaxMs"),
    maxRetries: config.get<number>("jobSearchMaxRetries")
  };
}

export function getTreeViewCurationOptions(
  config: vscode.WorkspaceConfiguration
): TreeViewCurationOptions {
  const configuredValue = config.get<unknown>(CONFIG_KEYS.treeViewsExcludedNames);
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
    CONFIG_KEYS.activityRefreshIntervalSeconds,
    DEFAULT_ACTIVITY_REFRESH_INTERVAL_SECONDS,
    MIN_ACTIVITY_REFRESH_INTERVAL_SECONDS,
    MAX_ACTIVITY_REFRESH_INTERVAL_SECONDS
  );
  return {
    maxItemsPerGroup: getClampedIntegerConfigValue(
      config,
      CONFIG_KEYS.activityMaxItemsPerGroup,
      DEFAULT_ACTIVITY_MAX_ITEMS_PER_GROUP,
      1,
      MAX_ACTIVITY_ITEMS_PER_GROUP
    ),
    collection: {
      maxScanResults: getClampedIntegerConfigValue(
        config,
        CONFIG_KEYS.activityMaxScanResults,
        DEFAULT_ACTIVITY_SCAN_MAX_RESULTS,
        MIN_ACTIVITY_SCAN_MAX_RESULTS,
        MAX_ACTIVITY_SCAN_MAX_RESULTS
      ),
      jobSearchBatchSize: getClampedIntegerConfigValue(
        config,
        CONFIG_KEYS.activityJobSearchBatchSize,
        DEFAULT_ACTIVITY_JOB_SEARCH_BATCH_SIZE,
        MIN_ACTIVITY_JOB_SEARCH_BATCH_SIZE,
        MAX_ACTIVITY_JOB_SEARCH_BATCH_SIZE
      ),
      pendingInputCandidateLimit: getClampedIntegerConfigValue(
        config,
        CONFIG_KEYS.activityPendingInputCandidateLimit,
        DEFAULT_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT,
        MIN_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT,
        MAX_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT
      ),
      pendingInputLookupConcurrency: getClampedIntegerConfigValue(
        config,
        CONFIG_KEYS.activityPendingInputLookupConcurrency,
        DEFAULT_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY,
        MIN_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY,
        MAX_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY
      ),
      pendingInputBuildLookupLimit: getClampedIntegerConfigValue(
        config,
        CONFIG_KEYS.activityPendingInputBuildLookupLimit,
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
  const configuredValue = config.get<unknown>(CONFIG_KEYS.currentBranchPullRequestJobNamePatterns);
  const patterns =
    typeof configuredValue === "undefined"
      ? DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS
      : normalizeStringList(configuredValue);
  return [
    ...(patterns.length > 0 ? patterns : DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS)
  ];
}

function getJenkinsfileValidationEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      CONFIG_KEYS.jenkinsfileValidationEnabled,
      DEFAULT_JENKINSFILE_VALIDATION_ENABLED
    )
  );
}

function getJenkinsfileIntelligenceEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      CONFIG_KEYS.jenkinsfileIntelligenceEnabled,
      DEFAULT_JENKINSFILE_INTELLIGENCE_ENABLED
    )
  );
}

function getJenkinsfileValidationRunOnSave(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      CONFIG_KEYS.jenkinsfileValidationRunOnSave,
      DEFAULT_JENKINSFILE_VALIDATION_RUN_ON_SAVE
    )
  );
}

function getJenkinsfileValidationChangeDebounceMs(config: vscode.WorkspaceConfiguration): number {
  return getBoundedIntegerConfigValue(
    config,
    CONFIG_KEYS.jenkinsfileValidationChangeDebounce,
    DEFAULT_JENKINSFILE_VALIDATION_DEBOUNCE_MS,
    0
  );
}

function getJenkinsfileValidationFilePatterns(config: vscode.WorkspaceConfiguration): string[] {
  const value = config.get<unknown>(
    CONFIG_KEYS.jenkinsfileValidationFilePatterns,
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
  return value.map((item) => trimToUndefined(item)).filter((item): item is string => Boolean(item));
}
