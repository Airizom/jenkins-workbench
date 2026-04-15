import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import { hasCoverageAction } from "../../jenkins/coverage/JenkinsCoverageActionPath";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type {
  PipelineRun,
  PipelineStage,
  PipelineStep
} from "../../jenkins/pipeline/PipelineTypes";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsTestReport,
  JenkinsTestSummaryAction
} from "../../jenkins/types";
import {
  formatCulprits,
  formatDuration,
  formatNumber,
  formatResult,
  formatResultClass,
  formatTestDuration,
  formatTimestamp,
  normalizePipelineStatus,
  truncateConsoleText
} from "./BuildDetailsFormatters";
import { isPipelineRestartEligible } from "./PipelineRestartEligibility";
import type {
  BuildCoverageFileViewModel,
  BuildCoverageQualityGateViewModel,
  BuildDetailsCoverageStateViewModel,
  BuildDetailsTestStateViewModel,
  BuildDetailsViewModel,
  BuildFailureArtifact,
  BuildFailureChangelogItem,
  BuildFailureInsightsViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel,
  PendingInputParameterViewModel,
  PendingInputViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "./shared/BuildDetailsContracts";

const INSIGHTS_LIST_LIMIT = 20;
const MAX_TEST_CASE_LOG_CHARS = 8000;
const TEST_CASE_LOG_TRUNCATION_SUFFIX = "\n... (truncated)";

export type {
  BuildCoverageFileViewModel,
  BuildCoverageQualityGateViewModel,
  BuildDetailsCoverageStateViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildDetailsTestStateViewModel,
  BuildTestsSummaryViewModel,
  BuildDetailsViewModel,
  BuildFailureArtifact,
  BuildFailureChangelogItem,
  BuildFailureInsightsViewModel,
  PendingInputParameterViewModel,
  PendingInputViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "./shared/BuildDetailsContracts";

export interface BuildDetailsViewModelInput {
  details?: JenkinsBuildDetails;
  buildUrl?: string;
  pipelineRun?: PipelineRun;
  pipelineLoading?: boolean;
  testReport?: JenkinsTestReport;
  testReportFetched?: boolean;
  testReportLogsIncluded?: boolean;
  coverageOverview?: JenkinsCoverageOverview;
  modifiedCoverageFiles?: JenkinsModifiedCoverageFile[];
  coverageActionPath?: string;
  coverageFetched?: boolean;
  coverageLoading?: boolean;
  coverageError?: string;
  coverageEnabled?: boolean;
  consoleTextResult?: JenkinsConsoleText;
  consoleHtmlResult?: { html: string; truncated: boolean };
  consoleError?: string;
  errors: string[];
  maxConsoleChars: number;
  followLog?: boolean;
  pendingInputs?: PendingInputAction[];
  pipelineRestartEnabled?: boolean;
  pipelineRestartableStages?: string[];
  testResultsLoading?: boolean;
  canOpenTestSource?: (className?: string) => boolean;
}

const PARAMETER_KIND_LABELS: Record<string, string> = {
  boolean: "Boolean",
  choice: "Choice",
  credentials: "Credentials",
  file: "File",
  multiChoice: "Multi Choice",
  password: "Password",
  run: "Run",
  string: "String",
  text: "Text"
};

export function buildBuildDetailsViewModel(
  input: BuildDetailsViewModelInput
): BuildDetailsViewModel {
  const details = input.details;
  const buildUrl = details?.url ?? input.buildUrl;
  const testState = buildTestStateViewModel(details, input.testReport, {
    testReportFetched: input.testReportFetched,
    logsIncluded: input.testReportLogsIncluded,
    loading: input.testResultsLoading,
    canOpenSource: input.canOpenTestSource
  });
  const coverageState = buildCoverageStateViewModel(details, input.coverageOverview, {
    modifiedFiles: input.modifiedCoverageFiles,
    actionPath: input.coverageActionPath,
    coverageFetched: input.coverageFetched,
    loading: input.coverageLoading,
    error: input.coverageError,
    enabled: input.coverageEnabled
  });
  const truncated = truncateConsoleText(input.consoleTextResult?.text ?? "", input.maxConsoleChars);
  const consoleTruncated =
    Boolean(input.consoleHtmlResult?.truncated) ||
    truncated.truncated ||
    Boolean(input.consoleTextResult?.truncated);
  const nonConsoleErrors = input.errors.filter(
    (error) => !error.toLowerCase().startsWith("console output:")
  );
  const consoleError = input.consoleError ?? extractConsoleError(input.errors);

  return {
    displayName: details?.fullDisplayName ?? details?.displayName ?? "Build Details",
    buildUrl,
    resultLabel: details ? formatResult(details) : "Unknown",
    resultClass: details ? formatResultClass(details) : "neutral",
    durationLabel: details ? formatDuration(details.duration) : "Unknown",
    timestampLabel: details ? formatTimestamp(details.timestamp) : "Unknown",
    culpritsLabel: details ? formatCulprits(details.culprits) : "Unknown",
    pipelineStagesLoading: Boolean(input.pipelineLoading),
    pipelineStages: buildPipelineStagesViewModel(input.pipelineRun, {
      details,
      restartEnabled: Boolean(input.pipelineRestartEnabled),
      restartableStages: input.pipelineRestartableStages ?? []
    }),
    testState,
    coverageState,
    insights: buildBuildFailureInsights(details, testState.summary),
    pendingInputs: buildPendingInputsViewModel(input.pendingInputs),
    consoleText: truncated.text,
    consoleHtml: input.consoleHtmlResult?.html,
    consoleTruncated,
    consoleMaxChars: input.maxConsoleChars,
    consoleError,
    errors: nonConsoleErrors,
    followLog: input.followLog ?? true
  };
}

function extractConsoleError(errors: string[]): string | undefined {
  const consoleError = errors.find((error) => error.toLowerCase().startsWith("console output:"));
  if (consoleError) {
    return consoleError.replace(/^console output:\s*/i, "");
  }
  return undefined;
}

export function buildPendingInputsViewModel(
  pendingInputs?: PendingInputAction[]
): PendingInputViewModel[] {
  if (!pendingInputs || pendingInputs.length === 0) {
    return [];
  }

  return pendingInputs.map((action) => {
    const parameters: PendingInputParameterViewModel[] = action.parameters.map((param) => ({
      name: param.name,
      kind: PARAMETER_KIND_LABELS[param.kind] ?? "String",
      description: param.description,
      choices: param.choices,
      defaultValue: param.defaultValue
    }));
    const parametersLabel =
      parameters.length > 0
        ? `Parameters: ${parameters.map((param) => `${param.name} (${param.kind})`).join(", ")}`
        : "No parameters";
    const submitterLabel = action.submitter ? `Submitter: ${action.submitter}` : "Submitter: Any";

    return {
      id: action.id,
      message: action.message,
      submitterLabel,
      parametersLabel,
      parameters
    };
  });
}

export function buildBuildFailureInsights(
  details?: JenkinsBuildDetails,
  testsSummary?: BuildTestsSummaryViewModel
): BuildFailureInsightsViewModel {
  const changelogItems = buildChangelog(details);
  const cappedChangelog = capList(changelogItems, INSIGHTS_LIST_LIMIT);

  const artifacts = buildArtifacts(details);
  const cappedArtifacts = capList(artifacts, INSIGHTS_LIST_LIMIT);

  return {
    changelogItems: cappedChangelog.items,
    changelogOverflow: cappedChangelog.overflow,
    testSummaryLabel: testsSummary?.summaryLabel ?? "No test results.",
    testResultsHint: testsSummary?.hasDetailedResults
      ? "Browse detailed results in the Test Results tab."
      : undefined,
    artifacts: cappedArtifacts.items,
    artifactsOverflow: cappedArtifacts.overflow
  };
}

function buildChangelog(details?: JenkinsBuildDetails): BuildFailureChangelogItem[] {
  if (!details) {
    return [];
  }
  const items: NonNullable<NonNullable<JenkinsBuildDetails["changeSet"]>["items"]> = [];
  if (details.changeSet?.items) {
    items.push(...details.changeSet.items);
  }
  if (details.changeSets) {
    for (const changeSet of details.changeSets) {
      if (changeSet.items) {
        items.push(...changeSet.items);
      }
    }
  }

  const seen = new Set<string>();
  const results: BuildFailureChangelogItem[] = [];

  for (const item of items) {
    const message = (item.msg ?? "").trim();
    const author = (item.author?.fullName ?? "").trim();
    const commitId = item.commitId?.trim();
    const key = commitId ? `id:${commitId}` : `${message}|${author}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({
      message: message || "Commit",
      author: author || "Unknown author",
      commitId
    });
  }

  return results;
}

interface BuildTestsSummaryOptions {
  testReportFetched?: boolean;
  logsIncluded?: boolean;
}

interface BuildTestStateOptions extends BuildTestsSummaryOptions {
  loading?: boolean;
  canOpenSource?: (className?: string) => boolean;
}

interface BuildCoverageStateOptions {
  modifiedFiles?: JenkinsModifiedCoverageFile[];
  actionPath?: string;
  coverageFetched?: boolean;
  loading?: boolean;
  error?: string;
  enabled?: boolean;
}

export function buildTestsSummary(
  details?: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: BuildTestsSummaryOptions
): BuildTestsSummaryViewModel {
  const action = findTestSummaryAction(details?.actions ?? null);
  const failed = pickNumber(testReport?.failCount, action?.failCount);
  const total = pickNumber(testReport?.totalCount, action?.totalCount);
  const skipped = pickNumber(testReport?.skipCount, action?.skipCount);
  const resolvedFailed = failed ?? 0;
  const resolvedTotal = total ?? 0;
  const resolvedSkipped = skipped ?? 0;
  const passedCount = Math.max(0, resolvedTotal - resolvedFailed - resolvedSkipped);
  const hasDetailedResults = Boolean(
    testReport?.suites?.some((suite) => (suite.cases?.length ?? 0) > 0)
  );
  const hasAnyResults =
    resolvedTotal > 0 || resolvedFailed > 0 || resolvedSkipped > 0 || hasDetailedResults;
  const detailsUnavailable =
    Boolean(options?.testReportFetched) && hasAnyResults && !hasDetailedResults;
  const logsIncluded = Boolean(options?.logsIncluded && hasDetailedResults);

  let label = "No test results.";
  if (!hasAnyResults) {
    label = "No test results.";
  } else if (typeof failed === "number" && typeof total === "number") {
    label = `Failed ${formatNumber(failed)} / ${formatNumber(total)}`;
    if (typeof skipped === "number") {
      label += ` • Skipped ${formatNumber(skipped)}`;
    }
  } else if (typeof total === "number") {
    label = `Total ${formatNumber(total)} tests`;
  } else if (typeof failed === "number") {
    label = `Failed ${formatNumber(failed)} tests`;
  }

  return {
    totalCount: resolvedTotal,
    failedCount: resolvedFailed,
    skippedCount: resolvedSkipped,
    passedCount,
    summaryLabel: label,
    hasAnyResults,
    hasDetailedResults,
    detailsUnavailable,
    logsIncluded,
    canLoadLogs: hasDetailedResults && !logsIncluded
  };
}

export function buildTestStateViewModel(
  details?: JenkinsBuildDetails,
  testReport?: JenkinsTestReport,
  options?: BuildTestStateOptions
): BuildDetailsTestStateViewModel {
  const summary = buildTestsSummary(details, testReport, options);
  const results = buildTestResultsViewModel(testReport, {
    canOpenSource: options?.canOpenSource,
    loading: options?.loading
  });
  return {
    summary,
    results
  };
}

export function buildCoverageStateViewModel(
  details: JenkinsBuildDetails | undefined,
  overview: JenkinsCoverageOverview | undefined,
  options?: BuildCoverageStateOptions
): BuildDetailsCoverageStateViewModel {
  const showTab = hasCoverageAction(details) || Boolean(options?.actionPath);
  if (!options?.enabled || details?.building) {
    return {
      status: "disabled",
      showTab: false,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false
    };
  }

  if (options.loading) {
    return {
      status: "loading",
      showTab,
      projectCoverage: overview?.projectCoverage,
      modifiedFilesCoverage: overview?.modifiedFilesCoverage,
      modifiedLinesCoverage: overview?.modifiedLinesCoverage,
      overallQualityGateStatusLabel: overview?.overallQualityGateStatus,
      overallQualityGateStatusClass: formatCoverageStatusClass(overview?.overallQualityGateStatus),
      qualityGates: buildCoverageQualityGateViewModel(overview?.qualityGates),
      modifiedFiles: buildCoverageFileViewModel(options.modifiedFiles),
      summaryOnly: !options.modifiedFiles || options.modifiedFiles.length === 0
    };
  }

  if (!options.coverageFetched) {
    return {
      status: "idle",
      showTab,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false
    };
  }

  if (options.error) {
    return {
      status: "error",
      showTab,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false,
      errorMessage: options.error
    };
  }

  const modifiedFiles = buildCoverageFileViewModel(options.modifiedFiles);
  const qualityGates = buildCoverageQualityGateViewModel(overview?.qualityGates);
  const hasCoverage =
    Boolean(overview?.projectCoverage) ||
    Boolean(overview?.modifiedFilesCoverage) ||
    Boolean(overview?.modifiedLinesCoverage) ||
    Boolean(overview?.overallQualityGateStatus) ||
    qualityGates.length > 0 ||
    modifiedFiles.length > 0;

  if (!hasCoverage) {
    return {
      status: "unavailable",
      showTab,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false
    };
  }

  return {
    status: "available",
    showTab,
    projectCoverage: overview?.projectCoverage,
    modifiedFilesCoverage: overview?.modifiedFilesCoverage,
    modifiedLinesCoverage: overview?.modifiedLinesCoverage,
    overallQualityGateStatusLabel: overview?.overallQualityGateStatus,
    overallQualityGateStatusClass: formatCoverageStatusClass(overview?.overallQualityGateStatus),
    qualityGates,
    modifiedFiles,
    summaryOnly: modifiedFiles.length === 0
  };
}

function buildCoverageQualityGateViewModel(
  qualityGates?: JenkinsCoverageOverview["qualityGates"]
): BuildCoverageQualityGateViewModel[] {
  if (!qualityGates || qualityGates.length === 0) {
    return [];
  }

  return qualityGates.map((qualityGate) => ({
    name: qualityGate.name,
    statusLabel: qualityGate.status,
    statusClass: formatCoverageStatusClass(qualityGate.status) ?? "neutral",
    thresholdLabel: formatCoverageThresholdLabel(qualityGate.threshold, qualityGate.value),
    valueLabel: qualityGate.value
  }));
}

function buildCoverageFileViewModel(
  files?: JenkinsModifiedCoverageFile[]
): BuildCoverageFileViewModel[] {
  if (!files || files.length === 0) {
    return [];
  }

  return files
    .map((file) => ({
      path: file.path,
      coveredCount: countModifiedCoverageLines(file.blocks, "covered"),
      missedCount: countModifiedCoverageLines(file.blocks, "missed"),
      partialCount: countModifiedCoverageLines(file.blocks, "partial")
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function countModifiedCoverageLines(
  blocks: JenkinsModifiedCoverageFile["blocks"],
  type: JenkinsModifiedCoverageFile["blocks"][number]["type"]
): number {
  return blocks.reduce((total, block) => {
    if (block.type !== type) {
      return total;
    }
    return total + (block.endLine - block.startLine + 1);
  }, 0);
}

function formatCoverageStatusClass(status?: string): string | undefined {
  const normalized = status?.trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return "success";
    case "WARNING":
    case "UNSTABLE":
      return "warning";
    case "ERROR":
    case "FAILURE":
    case "FAILED":
      return "failure";
    default:
      return normalized ? "neutral" : undefined;
  }
}

function formatCoverageThresholdLabel(threshold?: number, value?: string): string | undefined {
  if (typeof threshold !== "number") {
    return undefined;
  }

  const formatted = formatNumber(threshold);
  return value?.includes("%") ? `${formatted}%` : formatted;
}

type BuildAction = NonNullable<NonNullable<JenkinsBuildDetails["actions"]>[number]>;

function isTestSummaryAction(action: BuildAction): action is JenkinsTestSummaryAction {
  const candidate = action as JenkinsTestSummaryAction;
  return (
    typeof candidate.failCount === "number" ||
    typeof candidate.totalCount === "number" ||
    typeof candidate.skipCount === "number"
  );
}

function findTestSummaryAction(
  actions: JenkinsBuildDetails["actions"]
): JenkinsTestSummaryAction | undefined {
  if (!actions || actions.length === 0) {
    return undefined;
  }
  for (const action of actions) {
    if (action && isTestSummaryAction(action)) {
      return action;
    }
  }
  return undefined;
}

export function buildTestResultsViewModel(
  testReport: JenkinsTestReport | undefined,
  options?: { canOpenSource?: (className?: string) => boolean; loading?: boolean }
): BuildTestResultsViewModel {
  if (!testReport) {
    return buildEmptyTestResultsViewModel(options?.loading);
  }

  const items: BuildTestCaseViewModel[] = [];
  for (const [suiteIndex, suite] of (testReport.suites ?? []).entries()) {
    const suiteName = suite.name?.trim() || undefined;
    for (const [caseIndex, testCase] of (suite.cases ?? []).entries()) {
      const name = testCase.name?.trim() || testCase.className?.trim() || "Unnamed test";
      const className = testCase.className?.trim() || undefined;
      const status = normalizeTestStatus(testCase.status);
      items.push({
        id: buildTestCaseId(suiteName, className, name, suiteIndex, caseIndex),
        name,
        className,
        suiteName,
        status,
        statusLabel: formatTestStatusLabel(status),
        durationLabel: formatTestDuration(testCase.duration),
        errorDetails: normalizeTestText(testCase.errorDetails, true),
        errorStackTrace: normalizeTestText(testCase.errorStackTrace, true),
        stdout: normalizeTestText(testCase.stdout, true),
        stderr: normalizeTestText(testCase.stderr, true),
        canOpenSource: Boolean(options?.canOpenSource?.(className))
      });
    }
  }

  items.sort(compareTestCases);
  return {
    items,
    loading: Boolean(options?.loading)
  };
}

export function buildEmptyTestResultsViewModel(loading = false): BuildTestResultsViewModel {
  return {
    items: [],
    loading
  };
}

function isFailedTestCase(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.toUpperCase();
  if (normalized === "PASSED" || normalized === "SKIPPED") {
    return false;
  }
  return true;
}

function normalizeTestStatus(status?: string): BuildTestCaseViewModel["status"] {
  const normalized = status?.trim().toUpperCase();
  if (!normalized) {
    return "other";
  }
  if (normalized === "PASSED" || normalized === "FIXED") {
    return "passed";
  }
  if (normalized === "SKIPPED" || normalized === "REGRESSION_SKIPPED") {
    return "skipped";
  }
  if (isFailedTestCase(normalized)) {
    return "failed";
  }
  return "other";
}

function formatTestStatusLabel(status: BuildTestCaseViewModel["status"]): string {
  switch (status) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    default:
      return "Other";
  }
}

function buildTestCaseId(
  suiteName: string | undefined,
  className: string | undefined,
  name: string,
  suiteIndex: number,
  caseIndex: number
): string {
  return [suiteName ?? "", className ?? "", name, String(suiteIndex), String(caseIndex)].join("::");
}

function compareTestCases(left: BuildTestCaseViewModel, right: BuildTestCaseViewModel): number {
  const statusRank = getTestStatusSortRank(left.status) - getTestStatusSortRank(right.status);
  if (statusRank !== 0) {
    return statusRank;
  }
  const suiteRank = (left.suiteName ?? "").localeCompare(right.suiteName ?? "");
  if (suiteRank !== 0) {
    return suiteRank;
  }
  const classRank = (left.className ?? "").localeCompare(right.className ?? "");
  if (classRank !== 0) {
    return classRank;
  }
  return left.name.localeCompare(right.name);
}

function getTestStatusSortRank(status: BuildTestCaseViewModel["status"]): number {
  switch (status) {
    case "failed":
      return 0;
    case "skipped":
      return 1;
    case "passed":
      return 2;
    default:
      return 3;
  }
}

function normalizeTestText(value?: string, allowTruncation = false): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!allowTruncation || trimmed.length <= MAX_TEST_CASE_LOG_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_TEST_CASE_LOG_CHARS)}${TEST_CASE_LOG_TRUNCATION_SUFFIX}`;
}

function buildArtifacts(details?: JenkinsBuildDetails): BuildFailureArtifact[] {
  if (!details?.artifacts || details.artifacts.length === 0) {
    return [];
  }
  const items: BuildFailureArtifact[] = [];
  for (const artifact of details.artifacts) {
    const relativePath = (artifact.relativePath ?? "").trim();
    if (!relativePath) {
      continue;
    }
    const fileName = artifact.fileName?.trim();
    const name = fileName || relativePath || "Artifact";
    const entry: BuildFailureArtifact = {
      name,
      relativePath
    };
    if (fileName) {
      entry.fileName = fileName;
    }
    items.push(entry);
  }
  return items;
}

interface PipelineStageRestartContext {
  details?: JenkinsBuildDetails;
  restartEnabled: boolean;
  restartableStages: string[];
}

interface PipelineStageRestartState {
  enabled: boolean;
  restartableStages: Set<string>;
}

export function buildPipelineStagesViewModel(
  pipelineRun?: PipelineRun,
  restartContext?: PipelineStageRestartContext
): PipelineStageViewModel[] {
  const stages = pipelineRun?.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return [];
  }
  const restartState = createPipelineStageRestartState(restartContext);
  return stages.map((stage) => mapPipelineStage(stage, restartState));
}

interface PipelineStepDraft extends PipelineStageStepViewModel {
  isFailed: boolean;
}

function mapPipelineStage(
  stage: PipelineStage,
  restartState: PipelineStageRestartState
): PipelineStageViewModel {
  const key = stage.key;
  const status = normalizePipelineStatus(stage.status);
  const durationMs = normalizeDurationMillis(stage.durationMillis);
  const durationLabel = formatDuration(stage.durationMillis);
  const steps = stage.steps.map((step) => mapPipelineStep(step));
  const stepsFailedOnly = steps.filter((step) => step.isFailed);
  const stepsAll = steps.map((step) => stripFailure(step));
  const parallelBranches = mapParallelBranches(stage, restartState);
  const hasSteps = stepsAll.length > 0 || parallelBranches.some((branch) => branch.hasSteps);
  const stageName = stage.name.trim();
  const canRestartFromStage =
    restartState.enabled && stageName.length > 0 && restartState.restartableStages.has(stageName);

  return {
    key,
    name: stage.name,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel,
    durationMs,
    canRestartFromStage,
    hasSteps,
    stepsFailedOnly: stepsFailedOnly.map((step) => stripFailure(step)),
    stepsAll,
    parallelBranches
  };
}

function mapParallelBranches(
  stage: PipelineStage,
  restartState: PipelineStageRestartState
): PipelineStageViewModel[] {
  const branches = stage.parallelBranches;
  if (branches.length === 0) {
    return [];
  }
  return branches.map((branch) => mapPipelineStage(branch, restartState));
}

function createPipelineStageRestartState(
  context: PipelineStageRestartContext | undefined
): PipelineStageRestartState {
  if (!context || !isPipelineRestartEligible(context.details) || !context.restartEnabled) {
    return { enabled: false, restartableStages: new Set<string>() };
  }
  const restartableStages = new Set<string>();
  for (const stage of context.restartableStages) {
    const trimmed = stage.trim();
    if (trimmed.length === 0) {
      continue;
    }
    restartableStages.add(trimmed);
  }
  return { enabled: restartableStages.size > 0, restartableStages };
}

function mapPipelineStep(step: PipelineStep): PipelineStepDraft {
  const status = normalizePipelineStatus(step.status);
  const durationLabel = formatDuration(step.durationMillis);
  return {
    name: step.name,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel,
    isFailed: status.isFailed
  };
}

function stripFailure(step: PipelineStepDraft): PipelineStageStepViewModel {
  return {
    name: step.name,
    statusLabel: step.statusLabel,
    statusClass: step.statusClass,
    durationLabel: step.durationLabel
  };
}

function capList<T>(items: T[], limit: number): { items: T[]; overflow: number } {
  if (items.length <= limit) {
    return { items, overflow: 0 };
  }
  return {
    items: items.slice(0, limit),
    overflow: Math.max(0, items.length - limit)
  };
}

function pickNumber(primary?: number, fallback?: number): number | undefined {
  if (typeof primary === "number" && Number.isFinite(primary)) {
    return primary;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  return undefined;
}

function normalizeDurationMillis(duration?: number): number | undefined {
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return undefined;
  }
  return Math.max(0, Math.floor(duration));
}
