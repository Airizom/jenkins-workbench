import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsCoverageRequestOptions,
  JenkinsCoverageService
} from "../../jenkins/coverage/JenkinsCoverageService";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { JenkinsRestartFromStageInfo } from "../../jenkins/types";
import {
  BuildInspectionBackendAdapter,
  type BuildInspectionConsoleBackend,
  type BuildInspectionStatusBackend,
  type BuildInspectionTestsBackend
} from "../shared/backend/BuildInspectionBackend";

export type {
  BuildInspectionBackend as BuildDetailsInspectionBackend,
  BuildInspectionConsoleBackend as BuildDetailsConsoleBackend,
  BuildInspectionStatusBackend as BuildDetailsStatusBackend,
  BuildInspectionTestsBackend as BuildDetailsTestsBackend
} from "../shared/backend/BuildInspectionBackend";

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
  status: BuildInspectionStatusBackend;
  tests: BuildInspectionTestsBackend;
  coverage: BuildDetailsCoverageBackend;
  console: BuildInspectionConsoleBackend;
  pendingInputs: BuildDetailsPendingInputsBackend;
  restart: BuildDetailsRestartBackend;
}

export type BuildDetailsPendingInputProvider = Pick<
  BuildDetailsPendingInputsBackend,
  "getPendingInputActions"
>;

export class BuildDetailsBackendAdapter implements BuildDetailsBackend {
  readonly status: BuildInspectionStatusBackend;
  readonly tests: BuildInspectionTestsBackend;
  readonly coverage: BuildDetailsCoverageBackend;
  readonly console: BuildInspectionConsoleBackend;
  readonly pendingInputs: BuildDetailsPendingInputsBackend;
  readonly restart: BuildDetailsRestartBackend;

  constructor(dataService: JenkinsDataService, coverageService: JenkinsCoverageService) {
    const inspection = new BuildInspectionBackendAdapter(dataService);
    this.status = inspection.status;
    this.tests = inspection.tests;
    this.console = inspection.console;
    this.coverage = {
      discoverCoverageActionPath: (...args) => coverageService.discoverCoverageActionPath(...args),
      getCoverageOverview: (...args) => coverageService.getCoverageOverview(...args),
      getModifiedCoverageFiles: (...args) => coverageService.getModifiedCoverageFiles(...args)
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
