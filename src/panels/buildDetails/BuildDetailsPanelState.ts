import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import type { JenkinsBuildDetails, JenkinsTestReport } from "../../jenkins/types";
import type { BuildDetailsInitialState } from "./BuildDetailsPollingController";

export type PipelineRestartAvailability = "unknown" | "supported" | "unsupported";

export class BuildDetailsPanelState {
  private environmentValue: JenkinsEnvironmentRef | undefined;
  private currentBuildUrlValue: string | undefined;
  private currentDetailsValue: JenkinsBuildDetails | undefined;
  private currentTestReportValue: JenkinsTestReport | undefined;
  private currentPipelineRunValue: PipelineRun | undefined;
  private currentErrorsValue: string[] = [];
  private baseErrorsValue: string[] = [];
  private pipelineErrorValue: string | undefined;
  private currentPendingInputsValue: PendingInputAction[] = [];
  private pipelineRestartAvailabilityValue: PipelineRestartAvailability = "unknown";
  private pipelineRestartEnabledValue = false;
  private pipelineRestartableStagesValue: string[] = [];
  private followLogValue = true;
  private completionToastShownValue = false;
  private currentNonceValue = "";
  private lastDetailsBuildingValue = false;
  private pipelineLoadingValue = false;

  get environment(): JenkinsEnvironmentRef | undefined {
    return this.environmentValue;
  }

  get currentBuildUrl(): string | undefined {
    return this.currentBuildUrlValue;
  }

  get currentDetails(): JenkinsBuildDetails | undefined {
    return this.currentDetailsValue;
  }

  get currentTestReport(): JenkinsTestReport | undefined {
    return this.currentTestReportValue;
  }

  get currentPipelineRun(): PipelineRun | undefined {
    return this.currentPipelineRunValue;
  }

  get currentErrors(): string[] {
    return this.currentErrorsValue;
  }

  get currentPendingInputs(): PendingInputAction[] {
    return this.currentPendingInputsValue;
  }

  get pipelineRestartAvailability(): PipelineRestartAvailability {
    return this.pipelineRestartAvailabilityValue;
  }

  get pipelineRestartEnabled(): boolean {
    return this.pipelineRestartEnabledValue;
  }

  get pipelineRestartableStages(): string[] {
    return this.pipelineRestartableStagesValue;
  }

  get followLog(): boolean {
    return this.followLogValue;
  }

  get currentNonce(): string {
    return this.currentNonceValue;
  }

  get lastDetailsBuilding(): boolean {
    return this.lastDetailsBuildingValue;
  }

  get pipelineLoading(): boolean {
    return this.pipelineLoadingValue;
  }

  resetForLoad(environment: JenkinsEnvironmentRef, buildUrl: string, nonce: string): void {
    this.environmentValue = environment;
    this.currentBuildUrlValue = buildUrl;
    this.currentDetailsValue = undefined;
    this.currentTestReportValue = undefined;
    this.currentPipelineRunValue = undefined;
    this.currentErrorsValue = [];
    this.baseErrorsValue = [];
    this.pipelineErrorValue = undefined;
    this.currentPendingInputsValue = [];
    this.pipelineRestartAvailabilityValue = "unknown";
    this.pipelineRestartEnabledValue = false;
    this.pipelineRestartableStagesValue = [];
    this.completionToastShownValue = false;
    this.currentNonceValue = nonce;
    this.lastDetailsBuildingValue = false;
    this.pipelineLoadingValue = true;
  }

  applyInitialState(
    initialState: BuildDetailsInitialState,
    pipelineRun: PipelineRun | undefined,
    pipelineError: string | undefined
  ): void {
    this.currentDetailsValue = initialState.details;
    this.currentTestReportValue = undefined;
    this.currentPipelineRunValue = pipelineRun;
    this.baseErrorsValue = initialState.errors;
    this.pipelineErrorValue = pipelineError;
    this.currentPendingInputsValue = initialState.pendingInputs ?? [];
    this.pipelineRestartAvailabilityValue = "unknown";
    this.pipelineRestartEnabledValue = false;
    this.pipelineRestartableStagesValue = [];
    this.lastDetailsBuildingValue = initialState.details?.building ?? false;
    this.pipelineLoadingValue = false;
    this.currentErrorsValue = composeErrors(this.baseErrorsValue, this.pipelineErrorValue);
  }

  updateDetails(details: JenkinsBuildDetails): { wasBuilding: boolean; isBuilding: boolean } {
    const wasBuilding = this.lastDetailsBuildingValue;
    const isBuilding = Boolean(details.building);
    this.lastDetailsBuildingValue = isBuilding;
    this.currentDetailsValue = details;
    return { wasBuilding, isBuilding };
  }

  setTestReport(testReport: JenkinsTestReport | undefined): void {
    this.currentTestReportValue = testReport;
  }

  setPipelineRun(pipelineRun: PipelineRun | undefined): void {
    this.currentPipelineRunValue = pipelineRun;
    this.pipelineErrorValue = undefined;
    this.pipelineLoadingValue = false;
  }

  setPipelineError(pipelineError: string | undefined): void {
    this.pipelineErrorValue = pipelineError;
    this.pipelineLoadingValue = false;
  }

  setBaseErrors(errors: string[]): void {
    this.baseErrorsValue = errors;
  }

  setPipelineLoading(value: boolean): boolean {
    if (this.pipelineLoadingValue === value) {
      return false;
    }
    this.pipelineLoadingValue = value;
    return true;
  }

  setPendingInputs(pendingInputs: PendingInputAction[]): void {
    this.currentPendingInputsValue = pendingInputs;
  }

  setPipelineRestartInfo(
    restartEnabled: boolean,
    restartableStages: string[],
    availability: PipelineRestartAvailability
  ): boolean {
    const normalizedStages: string[] = [];
    for (const stage of restartableStages) {
      const trimmed = stage.trim();
      if (!trimmed || normalizedStages.includes(trimmed)) {
        continue;
      }
      normalizedStages.push(trimmed);
    }
    const availabilityChanged = this.pipelineRestartAvailabilityValue !== availability;
    const restartEnabledChanged = this.pipelineRestartEnabledValue !== restartEnabled;
    const stagesChanged = !areErrorsEqual(normalizedStages, this.pipelineRestartableStagesValue);
    if (!availabilityChanged && !restartEnabledChanged && !stagesChanged) {
      return false;
    }
    this.pipelineRestartAvailabilityValue = availability;
    this.pipelineRestartEnabledValue = restartEnabled;
    this.pipelineRestartableStagesValue = normalizedStages;
    return true;
  }

  setFollowLog(value: boolean): void {
    this.followLogValue = value;
  }

  takeCompletionToastSlot(): boolean {
    if (this.completionToastShownValue) {
      return false;
    }
    this.completionToastShownValue = true;
    return true;
  }

  updateErrors(): string[] | undefined {
    const nextErrors = composeErrors(this.baseErrorsValue, this.pipelineErrorValue);
    if (!areErrorsEqual(nextErrors, this.currentErrorsValue)) {
      this.currentErrorsValue = nextErrors;
      return nextErrors;
    }
    return undefined;
  }
}

function areErrorsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function composeErrors(baseErrors: string[], pipelineError?: string): string[] {
  const nextErrors = [...baseErrors];
  if (pipelineError && !nextErrors.includes(pipelineError)) {
    nextErrors.push(pipelineError);
  }
  return nextErrors;
}
