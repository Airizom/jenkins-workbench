import type { JenkinsDataService } from "../../../jenkins/JenkinsDataService";

export type BuildInspectionStatusBackend = Pick<
  JenkinsDataService,
  "getBuildDetails" | "getWorkflowRun"
>;

export type BuildInspectionTestsBackend = Pick<JenkinsDataService, "getTestReport">;

export type BuildInspectionConsoleBackend = Pick<
  JenkinsDataService,
  | "getConsoleText"
  | "getConsoleTextHead"
  | "getConsoleTextTail"
  | "getConsoleTextProgressive"
  | "getConsoleHtmlProgressive"
  | "getFlowNodeLog"
  | "getFlowNodeDetails"
  | "getFlowNodeLogHtmlProgressive"
>;

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
    this.status = dataService;
    this.tests = dataService;
    this.console = dataService;
  }
}
