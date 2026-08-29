import type { JenkinsDataService } from "../../../jenkins/JenkinsDataService";
import type { JenkinsBuildInspectionRuntimeSurface } from "../../../jenkins/JenkinsDataServiceRuntimeSurfaces";

export type BuildInspectionStatusBackend = Pick<
  JenkinsBuildInspectionRuntimeSurface,
  "getBuildDetails" | "getWorkflowRun"
>;

export type BuildInspectionTestsBackend = Pick<
  JenkinsBuildInspectionRuntimeSurface,
  "getTestReport"
>;

export type BuildInspectionConsoleBackend = Pick<
  JenkinsBuildInspectionRuntimeSurface,
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
