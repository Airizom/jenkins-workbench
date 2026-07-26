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
