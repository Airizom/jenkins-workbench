import type {
  PipelineRun,
  PipelineStage,
  PipelineStep
} from "../../jenkins/pipeline/PipelineTypes";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsTestReport
} from "../../jenkins/types";
import {
  formatCulprits,
  formatDuration,
  formatNumber,
  formatResult,
  formatResultClass,
  formatTimestamp,
  normalizePipelineStatus,
  truncateConsoleText
} from "./BuildDetailsFormatters";

const INSIGHTS_LIST_LIMIT = 20;

export interface BuildFailureChangelogItem {
  message: string;
  author: string;
  commitId?: string;
}

export interface BuildFailureFailedTest {
  name: string;
  className?: string;
}

export interface BuildFailureArtifact {
  name: string;
  openUrl: string;
  downloadUrl: string;
}

export interface PipelineStageStepViewModel {
  name: string;
  statusLabel: string;
  statusClass: string;
  durationLabel: string;
}

export interface PipelineStageViewModel {
  key: string;
  name: string;
  statusLabel: string;
  statusClass: string;
  durationLabel: string;
  hasSteps: boolean;
  stepsFailedOnly: PipelineStageStepViewModel[];
  stepsAll: PipelineStageStepViewModel[];
  parallelBranches: PipelineStageViewModel[];
}

export interface BuildFailureInsightsViewModel {
  changelogItems: BuildFailureChangelogItem[];
  changelogOverflow: number;
  testSummaryLabel: string;
  failedTests: BuildFailureFailedTest[];
  failedTestsOverflow: number;
  failedTestsMessage: string;
  artifacts: BuildFailureArtifact[];
  artifactsOverflow: number;
}

export interface BuildDetailsViewModel {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  pipelineStages: PipelineStageViewModel[];
  insights: BuildFailureInsightsViewModel;
  consoleText: string;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  errors: string[];
  followLog: boolean;
}

export interface BuildDetailsViewModelInput {
  details?: JenkinsBuildDetails;
  pipelineRun?: PipelineRun;
  testReport?: JenkinsTestReport;
  consoleTextResult?: JenkinsConsoleText;
  consoleError?: string;
  errors: string[];
  maxConsoleChars: number;
  followLog?: boolean;
}

export function buildBuildDetailsViewModel(
  input: BuildDetailsViewModelInput
): BuildDetailsViewModel {
  const details = input.details;
  const truncated = truncateConsoleText(input.consoleTextResult?.text ?? "", input.maxConsoleChars);
  const consoleTruncated = truncated.truncated || Boolean(input.consoleTextResult?.truncated);
  const nonConsoleErrors = input.errors.filter(
    (error) => !error.toLowerCase().startsWith("console output:")
  );
  const consoleError = input.consoleError ?? extractConsoleError(input.errors);

  return {
    displayName: details?.fullDisplayName ?? details?.displayName ?? "Build Details",
    resultLabel: details ? formatResult(details) : "Unknown",
    resultClass: details ? formatResultClass(details) : "neutral",
    durationLabel: details ? formatDuration(details.duration) : "Unknown",
    timestampLabel: details ? formatTimestamp(details.timestamp) : "Unknown",
    culpritsLabel: details ? formatCulprits(details.culprits) : "Unknown",
    pipelineStages: buildPipelineStagesViewModel(input.pipelineRun),
    insights: buildBuildFailureInsights(details, input.testReport),
    consoleText: truncated.text,
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

export function buildBuildFailureInsights(
  details?: JenkinsBuildDetails,
  testReport?: JenkinsTestReport
): BuildFailureInsightsViewModel {
  const changelogItems = buildChangelog(details);
  const cappedChangelog = capList(changelogItems, INSIGHTS_LIST_LIMIT);

  const artifacts = buildArtifacts(details);
  const cappedArtifacts = capList(artifacts, INSIGHTS_LIST_LIMIT);

  const testSummary = buildTestSummary(details, testReport);
  const failedTestsResult = buildFailedTests(testReport, testSummary.failed);
  const cappedFailedTests = capList(failedTestsResult.items, INSIGHTS_LIST_LIMIT);

  return {
    changelogItems: cappedChangelog.items,
    changelogOverflow: cappedChangelog.overflow,
    testSummaryLabel: testSummary.label,
    failedTests: cappedFailedTests.items,
    failedTestsOverflow: cappedFailedTests.overflow,
    failedTestsMessage: failedTestsResult.message,
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

function buildTestSummary(
  details?: JenkinsBuildDetails,
  testReport?: JenkinsTestReport
): { failed?: number; total?: number; skipped?: number; label: string } {
  const action = findTestSummaryAction(details?.actions ?? null);
  const failed = pickNumber(testReport?.failCount, action?.failCount);
  const total = pickNumber(testReport?.totalCount, action?.totalCount);
  const skipped = pickNumber(testReport?.skipCount, action?.skipCount);

  let label = "No test results.";
  if (typeof failed === "number" && typeof total === "number") {
    label = `Failed ${formatNumber(failed)} / ${formatNumber(total)}`;
    if (typeof skipped === "number") {
      label += ` • Skipped ${formatNumber(skipped)}`;
    }
  } else if (typeof total === "number") {
    label = `Total ${formatNumber(total)} tests`;
  } else if (typeof failed === "number") {
    label = `Failed ${formatNumber(failed)} tests`;
  }

  return { failed, total, skipped, label };
}

type TestSummaryAction = NonNullable<JenkinsBuildDetails["actions"]>[number];

function findTestSummaryAction(
  actions: JenkinsBuildDetails["actions"]
): TestSummaryAction | undefined {
  if (!actions || actions.length === 0) {
    return undefined;
  }
  return actions.find(
    (action) =>
      action !== null &&
      (typeof action.failCount === "number" ||
        typeof action.totalCount === "number" ||
        typeof action.skipCount === "number")
  );
}

function buildFailedTests(
  testReport?: JenkinsTestReport,
  failedCount?: number
): { items: BuildFailureFailedTest[]; message: string } {
  if (!testReport) {
    if (typeof failedCount === "number" && failedCount > 0) {
      return { items: [], message: "Failed test details unavailable." };
    }
    return { items: [], message: "Test report unavailable." };
  }

  const items: BuildFailureFailedTest[] = [];
  for (const suite of testReport.suites ?? []) {
    for (const testCase of suite.cases ?? []) {
      if (isFailedTestCase(testCase.status)) {
        const name = testCase.name ?? testCase.className ?? "Unnamed test";
        const className = testCase.name && testCase.className ? testCase.className : undefined;
        items.push({ name, className });
      }
    }
  }

  if (items.length === 0 && typeof failedCount === "number" && failedCount > 0) {
    return { items, message: "Failed test details unavailable." };
  }

  return { items, message: "No failed tests." };
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

function buildArtifacts(details?: JenkinsBuildDetails): BuildFailureArtifact[] {
  if (!details?.url || !details.artifacts || details.artifacts.length === 0) {
    return [];
  }
  const baseUrl = ensureTrailingSlash(details.url);
  return details.artifacts.map((artifact) => {
    const name = artifact.fileName || artifact.relativePath || "Artifact";
    const encodedPath = encodeArtifactPath(artifact.relativePath);
    const downloadUrl = new URL(`artifact/${encodedPath}`, baseUrl).toString();
    const openUrl = new URL(`artifact/${encodedPath}/*view*/`, baseUrl).toString();
    return { name, openUrl, downloadUrl };
  });
}

export function buildPipelineStagesViewModel(pipelineRun?: PipelineRun): PipelineStageViewModel[] {
  const stages = pipelineRun?.stages;
  if (!Array.isArray(stages) || stages.length === 0) {
    return [];
  }
  return stages.map((stage) => mapPipelineStage(stage));
}

interface PipelineStepDraft extends PipelineStageStepViewModel {
  isFailed: boolean;
}

function mapPipelineStage(stage: PipelineStage): PipelineStageViewModel {
  const key = stage.key;
  const status = normalizePipelineStatus(stage.status);
  const durationLabel = formatDuration(stage.durationMillis);
  const steps = stage.steps.map((step) => mapPipelineStep(step));
  const stepsFailedOnly = steps.filter((step) => step.isFailed);
  const stepsAll = steps.map((step) => stripFailure(step));
  const parallelBranches = mapParallelBranches(stage);
  const hasSteps = stepsAll.length > 0 || parallelBranches.some((branch) => branch.hasSteps);

  return {
    key,
    name: stage.name,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel,
    hasSteps,
    stepsFailedOnly: stepsFailedOnly.map((step) => stripFailure(step)),
    stepsAll,
    parallelBranches
  };
}

function mapParallelBranches(stage: PipelineStage): PipelineStageViewModel[] {
  const branches = stage.parallelBranches;
  if (branches.length === 0) {
    return [];
  }
  return branches.map((branch) => mapPipelineStage(branch));
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function encodeArtifactPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
