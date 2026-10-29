import type {
  BuildParameterPayload,
  JenkinsDataService,
  JobParameter
} from "../../jenkins/JenkinsDataService";
import type { JenkinsRunParameterLookupRuntimeSurface } from "../../jenkins/JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsParameterPresetStore,
  ParameterPreset
} from "../../storage/JenkinsParameterPresetStore";

export type ParameterValue = string | string[];

export interface BuildParameterPromptSelection {
  preset?: ParameterPreset;
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

/** What a single parameter prompt needs; run parameters look up builds through it. */
export interface ParameterValuePromptContext
  extends Pick<BuildParameterPromptOptions, "environment" | "jobUrl"> {
  dataService: JenkinsRunParameterLookupRuntimeSurface;
}

export interface BuildParameterPromptResult {
  payload: BuildParameterPayload;
  allowEmptyParams: boolean;
}
