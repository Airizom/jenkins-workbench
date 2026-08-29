import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type {
  JenkinsCoverageRuntimeSurface,
  JenkinsPendingInputActionRuntimeSurface,
  JenkinsPipelineRestartRuntimeSurface
} from "../../jenkins/JenkinsDataServiceRuntimeSurfaces";
import {
  BuildInspectionBackendAdapter,
  type BuildInspectionConsoleBackend,
  type BuildInspectionStatusBackend,
  type BuildInspectionTestsBackend
} from "../shared/backend/BuildInspectionBackend";

export type {
  BuildInspectionConsoleBackend as BuildDetailsConsoleBackend,
  BuildInspectionStatusBackend as BuildDetailsStatusBackend,
  BuildInspectionTestsBackend as BuildDetailsTestsBackend
} from "../shared/backend/BuildInspectionBackend";

export type BuildDetailsCoverageBackend = JenkinsCoverageRuntimeSurface;

export type BuildDetailsPendingInputsBackend = JenkinsPendingInputActionRuntimeSurface;

export type BuildDetailsRestartBackend = JenkinsPipelineRestartRuntimeSurface;

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

  constructor(dataService: JenkinsDataService) {
    const inspection = new BuildInspectionBackendAdapter(dataService);
    this.status = inspection.status;
    this.tests = inspection.tests;
    this.console = inspection.console;
    this.coverage = dataService;
    this.pendingInputs = dataService;
    this.restart = dataService;
  }
}
