import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsBuildDetails,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../../jenkins/types";
import type { BuildCompareBackend } from "./BuildCompareBackend";
import { buildChangesetsSection } from "./BuildCompareChangesetsSection";
import {
  buildConsoleComparisonSection,
  createLoadingConsoleComparisonSection
} from "./BuildCompareConsoleDiff";
import { type BuildCompareOptionalResult, loadOptionalData } from "./BuildCompareLoadState";
import type { BuildCompareOptions } from "./BuildCompareOptions";
import { buildParametersSection } from "./BuildCompareParametersSection";
import { buildBuildViewModel } from "./BuildCompareSectionShared";
import { buildStagesSection } from "./BuildCompareStagesSection";
import { buildTestsSection } from "./BuildCompareTestsSection";
import type { BuildCompareViewModel } from "./shared/BuildCompareContracts";

interface BuildCompareLoadOptions {
  compareOptions: BuildCompareOptions;
  environment: JenkinsEnvironmentRef;
  baselineBuildUrl: string;
  targetBuildUrl: string;
}

export async function loadBuildCompareViewModel(
  backend: BuildCompareBackend,
  options: BuildCompareLoadOptions
): Promise<BuildCompareViewModel> {
  const [baselineDetails, targetDetails] = await Promise.all([
    backend.status.getBuildDetails(options.environment, options.baselineBuildUrl, {
      includeParameters: true
    }),
    backend.status.getBuildDetails(options.environment, options.targetBuildUrl, {
      includeParameters: true
    })
  ]);

  const [baselineTestReport, targetTestReport, baselineWorkflowRun, targetWorkflowRun] =
    await Promise.all([
      loadOptionalData(() =>
        backend.tests.getTestReport(options.environment, options.baselineBuildUrl)
      ),
      loadOptionalData(() =>
        backend.tests.getTestReport(options.environment, options.targetBuildUrl)
      ),
      loadOptionalData(() =>
        backend.status.getWorkflowRun(options.environment, options.baselineBuildUrl)
      ),
      loadOptionalData(() =>
        backend.status.getWorkflowRun(options.environment, options.targetBuildUrl)
      )
    ]);

  return {
    title: "Build Compare",
    baseline: buildBuildViewModel("Baseline", baselineDetails),
    target: buildBuildViewModel("Target", targetDetails),
    tests: buildTestsSection(baselineTestReport, targetTestReport),
    parameters: buildParametersSection(
      baselineDetails,
      targetDetails,
      options.compareOptions.parameterRedaction
    ),
    changesets: buildChangesetsSection(baselineDetails, targetDetails),
    stages: buildStagesSection(baselineWorkflowRun, targetWorkflowRun),
    console: createLoadingConsoleComparisonSection(),
    errors: []
  };
}

export function loadBuildCompareConsoleViewModel(
  backend: BuildCompareBackend,
  options: BuildCompareLoadOptions
): Promise<BuildCompareViewModel["console"]> {
  return buildConsoleComparisonSection(
    backend,
    options.compareOptions.console,
    options.environment,
    options.baselineBuildUrl,
    options.targetBuildUrl
  );
}

export type { BuildCompareOptionalResult };
export type BuildCompareOptionalTestReportResult = BuildCompareOptionalResult<JenkinsTestReport>;
export type BuildCompareOptionalWorkflowRunResult = BuildCompareOptionalResult<JenkinsWorkflowRun>;
export type BuildCompareRequiredDetails = JenkinsBuildDetails;
