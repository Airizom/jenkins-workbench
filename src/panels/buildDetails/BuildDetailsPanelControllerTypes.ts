import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildDetailsBackend } from "./BuildDetailsBackend";
import type { PipelineRestartAvailability } from "./BuildDetailsPanelState";
import type {
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./shared/BuildDetailsContracts";
import type { BuildDetailsOutgoingMessage } from "./shared/BuildDetailsPanelMessages";

export interface BuildDetailsPanelLoadOptions {
  label?: string;
  panelState?: unknown;
}

export type BuildDetailsPanelLoadResult =
  | {
      status: "ok";
    }
  | {
      status: "missingAssets";
    };

export interface BuildDetailsPanelControllerAccess {
  getBackend(): BuildDetailsBackend | undefined;
  getEnvironment(): JenkinsEnvironmentRef | undefined;
  getBuildUrl(): string | undefined;
  getCurrentDetails(): JenkinsBuildDetails | undefined;
  getLoadToken(): number;
  getPipelineRestartAvailability(): PipelineRestartAvailability;
  getPipelineRestartEnabled(): boolean;
  getPipelineRestartableStages(): string[];
  getCurrentPipelineNodeLog(): PipelineNodeLogViewModel | undefined;
  selectPipelineLogTarget(target: PipelineLogTargetViewModel): void;
  clearPipelineLogTarget(): void;
  refreshBuildStatus(token: number): Promise<void>;
  refreshTestReport(
    token: number,
    options?: { includeCaseLogs?: boolean; showLoading?: boolean }
  ): Promise<void>;
  refreshCoverage(token: number, options?: { showLoading?: boolean }): Promise<void>;
  refreshPendingInputs(): Promise<void>;
  beginLoading(): number;
  endLoading(request: number): void;
  postMessage(message: BuildDetailsOutgoingMessage): void;
}
