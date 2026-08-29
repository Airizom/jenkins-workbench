import * as vscode from "vscode";
import { DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS } from "../currentBranch/CurrentBranchPullRequestJobPatterns";
import type { BuildListFetchOptions, JobSearchOptions } from "../jenkins/JenkinsDataService";
import type {
  BuildCompareOptions,
  BuildParameterRedactionOptions
} from "../panels/buildCompare/BuildCompareOptions";
import { trimToUndefined } from "../shared/stringValues";
import type { TreeActivityOptions } from "../tree/ActivityTypes";
import type { BuildTooltipOptions } from "../tree/BuildTooltips";
import type { TreeViewCurationOptions } from "../tree/TreeViewCuration";
import * as definitions from "./ExtensionConfigDefinitions";
import {
  getBoundedIntegerConfigValue,
  getClampedIntegerConfigValue,
  getFiniteNumberConfigValue,
  normalizeStringList
} from "./ExtensionConfigValueReaders";

export type { ConfigKey } from "./ExtensionConfigDefinitions";
export { CONFIG_KEYS, CONFIG_SECTION } from "./ExtensionConfigDefinitions";
export {
  getJenkinsfileIntelligenceConfig,
  getJenkinsfileValidationConfig
} from "./JenkinsfileExtensionConfig";

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(definitions.CONFIG_SECTION);
}

export function buildConfigKey(key: string): string {
  return `${definitions.CONFIG_SECTION}.${key}`;
}

export function getCacheTtlMs(config: vscode.WorkspaceConfiguration): number {
  const cacheTtlSeconds = getFiniteNumberConfigValue(
    config,
    definitions.CONFIG_KEYS.cacheTtlSeconds,
    definitions.DEFAULT_CACHE_TTL_SECONDS
  );
  return Math.max(0, cacheTtlSeconds) * 1000;
}

export function getStatusRefreshIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const refreshIntervalSeconds = getFiniteNumberConfigValue(
    config,
    definitions.CONFIG_KEYS.statusRefreshIntervalSeconds,
    definitions.DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS
  );
  return Math.max(definitions.MIN_STATUS_REFRESH_INTERVAL_SECONDS, refreshIntervalSeconds);
}

export function getWatchErrorThreshold(config: vscode.WorkspaceConfiguration): number {
  return getFiniteNumberConfigValue(
    config,
    definitions.CONFIG_KEYS.watchErrorThreshold,
    definitions.DEFAULT_WATCH_ERROR_THRESHOLD
  );
}

export function getQueuePollIntervalSeconds(config: vscode.WorkspaceConfiguration): number {
  const pollIntervalSeconds = getFiniteNumberConfigValue(
    config,
    definitions.CONFIG_KEYS.queuePollIntervalSeconds,
    definitions.DEFAULT_QUEUE_POLL_INTERVAL_SECONDS
  );
  return Math.max(definitions.MIN_QUEUE_POLL_INTERVAL_SECONDS, pollIntervalSeconds);
}

export function getJenkinsTaskRunnerOptions(
  config: vscode.WorkspaceConfiguration = getExtensionConfiguration()
): {
  pollIntervalMs: number;
  maxConsecutiveErrors: number;
} {
  const pollIntervalSeconds = getFiniteNumberConfigValue(
    config,
    definitions.CONFIG_KEYS.taskRunnerPollIntervalSeconds,
    definitions.DEFAULT_TASK_RUNNER_POLL_INTERVAL_SECONDS
  );
  return {
    pollIntervalMs:
      Math.max(definitions.MIN_TASK_RUNNER_POLL_INTERVAL_SECONDS, pollIntervalSeconds) * 1000,
    maxConsecutiveErrors: getBoundedIntegerConfigValue(
      config,
      definitions.CONFIG_KEYS.taskRunnerMaxConsecutiveErrors,
      definitions.DEFAULT_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS,
      definitions.MIN_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS
    )
  };
}

export interface BuildDiagnosticsConfig {
  enabled: boolean;
  maxLogBytes: number;
  maxProblems: number;
  profiles: unknown;
}

export function getBuildDiagnosticsConfig(
  config: vscode.WorkspaceConfiguration = getExtensionConfiguration()
): BuildDiagnosticsConfig {
  return {
    enabled: config.get<boolean>(definitions.CONFIG_KEYS.diagnosticsEnabled, true),
    maxLogBytes: getClampedIntegerConfigValue(
      config,
      definitions.CONFIG_KEYS.diagnosticsMaxLogBytes,
      definitions.DEFAULT_DIAGNOSTICS_MAX_LOG_BYTES,
      definitions.MIN_DIAGNOSTICS_MAX_LOG_BYTES,
      definitions.MAX_DIAGNOSTICS_MAX_LOG_BYTES
    ),
    maxProblems: getClampedIntegerConfigValue(
      config,
      definitions.CONFIG_KEYS.diagnosticsMaxProblems,
      definitions.DEFAULT_DIAGNOSTICS_MAX_PROBLEMS,
      1,
      definitions.MAX_DIAGNOSTICS_MAX_PROBLEMS
    ),
    profiles: config.get<unknown>(definitions.CONFIG_KEYS.diagnosticsProfiles, {})
  };
}

export function getRequestTimeoutMs(config: vscode.WorkspaceConfiguration): number {
  const timeoutSeconds = getFiniteNumberConfigValue(
    config,
    "requestTimeoutSeconds",
    definitions.DEFAULT_REQUEST_TIMEOUT_SECONDS
  );
  return Math.max(5, timeoutSeconds) * 1000;
}

export function getMaxCacheEntries(config: vscode.WorkspaceConfiguration): number {
  return getClampedIntegerConfigValue(
    config,
    "maxCacheEntries",
    definitions.DEFAULT_MAX_CACHE_ENTRIES,
    100,
    definitions.MAX_CACHE_ENTRIES
  );
}

function getBuildTooltipDetailsEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      definitions.CONFIG_KEYS.buildTooltipDetails,
      definitions.DEFAULT_BUILD_TOOLTIP_DETAILS
    )
  );
}

function getBuildTooltipParametersEnabled(config: vscode.WorkspaceConfiguration): boolean {
  return Boolean(
    config.get<boolean>(
      definitions.CONFIG_KEYS.buildTooltipParametersEnabled,
      definitions.DEFAULT_BUILD_TOOLTIP_PARAMETERS_ENABLED
    )
  );
}

function getArtifactDownloadRoot(config: vscode.WorkspaceConfiguration): string {
  const configuredRoot = config.get<unknown>("artifactDownloadRoot");
  return typeof configuredRoot === "string" && configuredRoot.trim()
    ? configuredRoot
    : definitions.DEFAULT_ARTIFACT_DOWNLOAD_ROOT;
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
  const value = config.get<number>(
    "artifactMaxDownloadMb",
    definitions.DEFAULT_ARTIFACT_MAX_DOWNLOAD_MB
  );
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value * 1024 * 1024);
}

export function getArtifactPreviewCacheMaxEntries(config: vscode.WorkspaceConfiguration): number {
  return getClampedIntegerConfigValue(
    config,
    "artifactPreviewCacheMaxEntries",
    definitions.DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES,
    1,
    definitions.MAX_ARTIFACT_PREVIEW_CACHE_ENTRIES
  );
}

export function getArtifactPreviewCacheMaxBytes(config: vscode.WorkspaceConfiguration): number {
  const maxMegabytes = getBoundedIntegerConfigValue(
    config,
    "artifactPreviewCacheMaxMb",
    definitions.DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB,
    1
  );
  return maxMegabytes * 1024 * 1024;
}

export function getArtifactPreviewCacheTtlMs(config: vscode.WorkspaceConfiguration): number {
  const ttlSeconds = getBoundedIntegerConfigValue(
    config,
    "artifactPreviewCacheTtlSeconds",
    definitions.DEFAULT_ARTIFACT_PREVIEW_CACHE_TTL_SECONDS,
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
    config.get<unknown>(definitions.CONFIG_KEYS.buildTooltipParametersAllowList)
  );
  const denyList = normalizeStringList(
    config.get<unknown>(definitions.CONFIG_KEYS.buildTooltipParametersDenyList)
  );
  const maskPatterns = normalizeStringList(
    config.get<unknown>(
      definitions.CONFIG_KEYS.buildTooltipParametersMaskPatterns,
      definitions.DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_PATTERNS
    )
  );
  const maskValue =
    trimToUndefined(config.get<unknown>(definitions.CONFIG_KEYS.buildTooltipParametersMaskValue)) ??
    definitions.DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_VALUE;

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
        definitions.DEFAULT_BUILD_COMPARE_CONSOLE_MAX_BYTES,
        1024
      ),
      maxLines: getBoundedIntegerConfigValue(
        config,
        "buildCompare.console.maxLines",
        definitions.DEFAULT_BUILD_COMPARE_CONSOLE_MAX_LINES,
        100
      )
    },
    parameterRedaction: getBuildParameterRedactionOptions(config)
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
  const configuredValue = config.get<unknown>(definitions.CONFIG_KEYS.treeViewsExcludedNames);
  const excludedNames =
    typeof configuredValue === "undefined"
      ? definitions.DEFAULT_TREE_VIEW_CURATION_EXCLUDED_NAMES
      : normalizeStringList(configuredValue);
  return {
    excludedNames
  };
}

export function getTreeActivityOptions(config: vscode.WorkspaceConfiguration): TreeActivityOptions {
  const refreshIntervalSeconds = getClampedIntegerConfigValue(
    config,
    definitions.CONFIG_KEYS.activityRefreshIntervalSeconds,
    definitions.DEFAULT_ACTIVITY_REFRESH_INTERVAL_SECONDS,
    definitions.MIN_ACTIVITY_REFRESH_INTERVAL_SECONDS,
    definitions.MAX_ACTIVITY_REFRESH_INTERVAL_SECONDS
  );
  return {
    maxItemsPerGroup: getClampedIntegerConfigValue(
      config,
      definitions.CONFIG_KEYS.activityMaxItemsPerGroup,
      definitions.DEFAULT_ACTIVITY_MAX_ITEMS_PER_GROUP,
      1,
      definitions.MAX_ACTIVITY_ITEMS_PER_GROUP
    ),
    collection: {
      maxScanResults: getClampedIntegerConfigValue(
        config,
        definitions.CONFIG_KEYS.activityMaxScanResults,
        definitions.DEFAULT_ACTIVITY_SCAN_MAX_RESULTS,
        definitions.MIN_ACTIVITY_SCAN_MAX_RESULTS,
        definitions.MAX_ACTIVITY_SCAN_MAX_RESULTS
      ),
      jobSearchBatchSize: getClampedIntegerConfigValue(
        config,
        definitions.CONFIG_KEYS.activityJobSearchBatchSize,
        definitions.DEFAULT_ACTIVITY_JOB_SEARCH_BATCH_SIZE,
        definitions.MIN_ACTIVITY_JOB_SEARCH_BATCH_SIZE,
        definitions.MAX_ACTIVITY_JOB_SEARCH_BATCH_SIZE
      ),
      pendingInputCandidateLimit: getClampedIntegerConfigValue(
        config,
        definitions.CONFIG_KEYS.activityPendingInputCandidateLimit,
        definitions.DEFAULT_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT,
        definitions.MIN_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT,
        definitions.MAX_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT
      ),
      pendingInputLookupConcurrency: getClampedIntegerConfigValue(
        config,
        definitions.CONFIG_KEYS.activityPendingInputLookupConcurrency,
        definitions.DEFAULT_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY,
        definitions.MIN_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY,
        definitions.MAX_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY
      ),
      pendingInputBuildLookupLimit: getClampedIntegerConfigValue(
        config,
        definitions.CONFIG_KEYS.activityPendingInputBuildLookupLimit,
        definitions.DEFAULT_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT,
        definitions.MIN_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT,
        definitions.MAX_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT
      ),
      refreshMinIntervalMs: refreshIntervalSeconds * 1000
    }
  };
}

export function getCurrentBranchPullRequestJobNamePatterns(
  config: vscode.WorkspaceConfiguration
): string[] {
  const configuredValue = config.get<unknown>(
    definitions.CONFIG_KEYS.currentBranchPullRequestJobNamePatterns
  );
  const patterns =
    typeof configuredValue === "undefined"
      ? DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS
      : normalizeStringList(configuredValue);
  return [
    ...(patterns.length > 0 ? patterns : DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS)
  ];
}
