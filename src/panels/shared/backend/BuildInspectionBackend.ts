import type { JenkinsDataService } from "../../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "../../../jenkins/JenkinsTestReportOptions";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsFlowNodeLog,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsTestReport,
  JenkinsWorkflowRun,
  JenkinsWorkflowStage
} from "../../../jenkins/types";

export interface BuildInspectionStatusBackend {
  getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { includeParameters?: boolean }
  ): Promise<JenkinsBuildDetails>;
  getWorkflowRun(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsWorkflowRun | undefined>;
}

export interface BuildInspectionTestsBackend {
  getTestReport(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport | undefined>;
}

export interface BuildInspectionConsoleBackend {
  getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<JenkinsConsoleText>;
  getConsoleTextHead(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxBytes: number
  ): Promise<JenkinsConsoleText>;
  getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<JenkinsConsoleTextTail>;
  getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    maxBytes?: number
  ): Promise<JenkinsProgressiveConsoleText>;
  getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml>;
  getFlowNodeLog(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string
  ): Promise<JenkinsFlowNodeLog | undefined>;
  getFlowNodeDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string
  ): Promise<JenkinsWorkflowStage | undefined>;
  getFlowNodeLogHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    nodeId: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml | undefined>;
}

export interface BuildInspectionBackend {
  status: BuildInspectionStatusBackend;
  tests: BuildInspectionTestsBackend;
  console: BuildInspectionConsoleBackend;
}

export class BuildInspectionBackendAdapter implements BuildInspectionBackend {
  readonly status: BuildInspectionStatusBackend;
  readonly tests: BuildInspectionTestsBackend;
  readonly console: BuildInspectionConsoleBackend;

  constructor(dataService: JenkinsDataService) {
    this.status = {
      getBuildDetails: (...args) => dataService.getBuildDetails(...args),
      getWorkflowRun: (...args) => dataService.getWorkflowRun(...args)
    };
    this.tests = {
      getTestReport: (...args) => dataService.getTestReport(...args)
    };
    this.console = {
      getConsoleText: (...args) => dataService.getConsoleText(...args),
      getConsoleTextHead: (...args) => dataService.getConsoleTextHead(...args),
      getConsoleTextTail: (...args) => dataService.getConsoleTextTail(...args),
      getConsoleTextProgressive: (...args) => dataService.getConsoleTextProgressive(...args),
      getConsoleHtmlProgressive: (...args) => dataService.getConsoleHtmlProgressive(...args),
      getFlowNodeLog: (...args) => dataService.getFlowNodeLog(...args),
      getFlowNodeDetails: (...args) => dataService.getFlowNodeDetails(...args),
      getFlowNodeLogHtmlProgressive: (...args) => dataService.getFlowNodeLogHtmlProgressive(...args)
    };
  }
}
