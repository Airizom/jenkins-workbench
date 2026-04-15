import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "../../jenkins/JenkinsTestReportOptions";
import type {
  JenkinsCoverageRequestOptions,
  JenkinsCoverageService
} from "../../jenkins/coverage/JenkinsCoverageService";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsRestartFromStageInfo,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../../jenkins/types";

export interface BuildDetailsStatusBackend {
  getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsBuildDetails>;
  getWorkflowRun(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsWorkflowRun | undefined>;
}

export interface BuildDetailsTestsBackend {
  getTestReport(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport | undefined>;
}

export interface BuildDetailsCoverageBackend {
  discoverCoverageActionPath(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<string | undefined>;
  getCoverageOverview(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsCoverageOverview | undefined>;
  getModifiedCoverageFiles(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsCoverageRequestOptions
  ): Promise<JenkinsModifiedCoverageFile[] | undefined>;
}

export interface BuildDetailsConsoleBackend {
  getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<JenkinsConsoleText>;
  getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<JenkinsConsoleTextTail>;
  getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number
  ): Promise<JenkinsProgressiveConsoleText>;
  getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml>;
}

export interface BuildDetailsPendingInputsBackend {
  getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]>;
  approveInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void>;
  rejectInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    abortUrl?: string
  ): Promise<void>;
}

export interface BuildDetailsRestartBackend {
  getRestartFromStageInfo(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsRestartFromStageInfo>;
  restartPipelineFromStage(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    stageName: string
  ): Promise<void>;
}

export interface BuildDetailsBackend {
  status: BuildDetailsStatusBackend;
  tests: BuildDetailsTestsBackend;
  coverage: BuildDetailsCoverageBackend;
  console: BuildDetailsConsoleBackend;
  pendingInputs: BuildDetailsPendingInputsBackend;
  restart: BuildDetailsRestartBackend;
}

export type BuildDetailsPendingInputProvider = Pick<
  BuildDetailsPendingInputsBackend,
  "getPendingInputActions"
>;

export class BuildDetailsBackendAdapter implements BuildDetailsBackend {
  readonly status: BuildDetailsStatusBackend;
  readonly tests: BuildDetailsTestsBackend;
  readonly coverage: BuildDetailsCoverageBackend;
  readonly console: BuildDetailsConsoleBackend;
  readonly pendingInputs: BuildDetailsPendingInputsBackend;
  readonly restart: BuildDetailsRestartBackend;

  constructor(dataService: JenkinsDataService, coverageService: JenkinsCoverageService) {
    this.status = {
      getBuildDetails: (...args) => dataService.getBuildDetails(...args),
      getWorkflowRun: (...args) => dataService.getWorkflowRun(...args)
    };
    this.tests = {
      getTestReport: (...args) => dataService.getTestReport(...args)
    };
    this.coverage = {
      discoverCoverageActionPath: (...args) => coverageService.discoverCoverageActionPath(...args),
      getCoverageOverview: (...args) => coverageService.getCoverageOverview(...args),
      getModifiedCoverageFiles: (...args) => coverageService.getModifiedCoverageFiles(...args)
    };
    this.console = {
      getConsoleText: (...args) => dataService.getConsoleText(...args),
      getConsoleTextTail: (...args) => dataService.getConsoleTextTail(...args),
      getConsoleTextProgressive: (...args) => dataService.getConsoleTextProgressive(...args),
      getConsoleHtmlProgressive: (...args) => dataService.getConsoleHtmlProgressive(...args)
    };
    this.pendingInputs = {
      getPendingInputActions: (...args) => dataService.getPendingInputActions(...args),
      approveInput: (...args) => dataService.approveInput(...args),
      rejectInput: (...args) => dataService.rejectInput(...args)
    };
    this.restart = {
      getRestartFromStageInfo: (...args) => dataService.getRestartFromStageInfo(...args),
      restartPipelineFromStage: (...args) => dataService.restartPipelineFromStage(...args)
    };
  }
}
