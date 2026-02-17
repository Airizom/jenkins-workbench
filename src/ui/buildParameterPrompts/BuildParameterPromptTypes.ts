import type { BuildParameterPayload, JobParameter } from "../../jenkins/JenkinsDataService";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsParameterPresetStore,
  ParameterPreset,
  ParameterPresetSummary
} from "../../storage/JenkinsParameterPresetStore";

export type ParameterValue = string | string[];

export interface BuildParameterPromptSelection {
  preset?: ParameterPreset;
  presetSummary?: ParameterPresetSummary;
}

export interface BuildParameterPromptValues {
  payload: BuildParameterPayload;
  values: Record<string, ParameterValue>;
}

export interface BuildParameterPromptOptions {
  dataService: JenkinsDataService;
  presetStore: JenkinsParameterPresetStore;
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  jobLabel: string;
  parameters: JobParameter[];
}

export interface BuildParameterPromptResult {
  payload: BuildParameterPayload;
  allowEmptyParams: boolean;
}
