export const CONFIG_SECTION = "jenkinsWorkbench";

export const CONFIG_KEYS = {
  cacheTtlSeconds: "cacheTtlSeconds",
  statusRefreshIntervalSeconds: "pollIntervalSeconds",
  watchErrorThreshold: "watchErrorThreshold",
  queuePollIntervalSeconds: "queuePollIntervalSeconds",
  taskRunnerPollIntervalSeconds: "taskRunner.pollIntervalSeconds",
  taskRunnerMaxConsecutiveErrors: "taskRunner.maxConsecutiveErrors",
  diagnosticsEnabled: "diagnostics.enabled",
  diagnosticsMaxLogBytes: "diagnostics.maxLogBytes",
  diagnosticsMaxProblems: "diagnostics.maxProblems",
  diagnosticsProfiles: "diagnostics.profiles",
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

export const DEFAULT_CACHE_TTL_SECONDS = 300;
export const DEFAULT_STATUS_REFRESH_INTERVAL_SECONDS = 60;
export const MIN_STATUS_REFRESH_INTERVAL_SECONDS = 5;
export const DEFAULT_WATCH_ERROR_THRESHOLD = 3;
export const DEFAULT_QUEUE_POLL_INTERVAL_SECONDS = 10;
export const MIN_QUEUE_POLL_INTERVAL_SECONDS = 2;
export const DEFAULT_TASK_RUNNER_POLL_INTERVAL_SECONDS = 2;
export const MIN_TASK_RUNNER_POLL_INTERVAL_SECONDS = 1;
export const DEFAULT_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS = 5;
export const MIN_TASK_RUNNER_MAX_CONSECUTIVE_ERRORS = 1;
export const DEFAULT_DIAGNOSTICS_MAX_LOG_BYTES = 32 * 1024 * 1024;
export const MIN_DIAGNOSTICS_MAX_LOG_BYTES = 64 * 1024;
export const MAX_DIAGNOSTICS_MAX_LOG_BYTES = 512 * 1024 * 1024;
export const DEFAULT_DIAGNOSTICS_MAX_PROBLEMS = 500;
export const MAX_DIAGNOSTICS_MAX_PROBLEMS = 500;
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_CACHE_ENTRIES = 1000;
export const MAX_CACHE_ENTRIES = 100_000;
export const DEFAULT_BUILD_TOOLTIP_DETAILS = false;
export const DEFAULT_BUILD_TOOLTIP_PARAMETERS_ENABLED = false;
export const DEFAULT_ARTIFACT_DOWNLOAD_ROOT = "jenkins-artifacts";
export const DEFAULT_ARTIFACT_MAX_DOWNLOAD_MB = 100;
export const DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_ENTRIES = 50;
export const MAX_ARTIFACT_PREVIEW_CACHE_ENTRIES = 1000;
export const DEFAULT_ARTIFACT_PREVIEW_CACHE_MAX_MB = 200;
export const DEFAULT_ARTIFACT_PREVIEW_CACHE_TTL_SECONDS = 900;
export const DEFAULT_BUILD_COMPARE_CONSOLE_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_BUILD_COMPARE_CONSOLE_MAX_LINES = 50_000;
export const DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_VALUE = "[redacted]";
export const DEFAULT_TREE_VIEW_CURATION_EXCLUDED_NAMES = ["all"];
export const DEFAULT_ACTIVITY_MAX_ITEMS_PER_GROUP = 50;
export const MAX_ACTIVITY_ITEMS_PER_GROUP = 100;
export const MIN_ACTIVITY_SCAN_MAX_RESULTS = 100;
export const DEFAULT_ACTIVITY_SCAN_MAX_RESULTS = 2000;
export const MAX_ACTIVITY_SCAN_MAX_RESULTS = 10_000;
export const MIN_ACTIVITY_JOB_SEARCH_BATCH_SIZE = 10;
export const DEFAULT_ACTIVITY_JOB_SEARCH_BATCH_SIZE = 50;
export const MAX_ACTIVITY_JOB_SEARCH_BATCH_SIZE = 200;
export const MIN_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT = 0;
export const DEFAULT_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT = 100;
export const MAX_ACTIVITY_PENDING_INPUT_CANDIDATE_LIMIT = 500;
export const MIN_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY = 1;
export const DEFAULT_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY = 4;
export const MAX_ACTIVITY_PENDING_INPUT_LOOKUP_CONCURRENCY = 10;
export const MIN_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT = 1;
export const DEFAULT_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT = 5;
export const MAX_ACTIVITY_PENDING_INPUT_BUILD_LOOKUP_LIMIT = 20;
export const MIN_ACTIVITY_REFRESH_INTERVAL_SECONDS = 5;
export const DEFAULT_ACTIVITY_REFRESH_INTERVAL_SECONDS = 60;
export const MAX_ACTIVITY_REFRESH_INTERVAL_SECONDS = 3600;
export const DEFAULT_BUILD_TOOLTIP_PARAMETER_MASK_PATTERNS = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "credential",
  "passphrase"
];
export const DEFAULT_JENKINSFILE_VALIDATION_ENABLED = true;
export const DEFAULT_JENKINSFILE_VALIDATION_RUN_ON_SAVE = true;
export const DEFAULT_JENKINSFILE_VALIDATION_DEBOUNCE_MS = 500;
export const DEFAULT_JENKINSFILE_INTELLIGENCE_ENABLED = true;
export const DEFAULT_JENKINSFILE_VALIDATION_FILE_PATTERNS = [
  "**/Jenkinsfile",
  "**/*.jenkinsfile",
  "**/Jenkinsfile.*"
];
