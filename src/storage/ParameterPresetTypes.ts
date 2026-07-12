export type ParameterPresetValue = string | string[];

export type ParameterPresetValues = Record<string, ParameterPresetValue>;

export interface ParameterPresetSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ParameterPreset extends ParameterPresetSummary {
  values: ParameterPresetValues;
}

export interface ParameterPresetSaveInput {
  id?: string;
  name: string;
  values: ParameterPresetValues;
  secretValues?: ParameterPresetValues;
  /**
   * Names of secret parameters whose previously stored values must be kept as-is.
   * Secrets that are neither re-saved via `secretValues` nor listed here are deleted
   * (the parameter was removed from the preset or the user cleared it).
   * Ignored when `secretValues` is undefined, which preserves all existing secrets.
   */
  keepSecretNames?: readonly string[];
}

export interface StoredParameterPreset {
  id: string;
  name: string;
  updatedAt: number;
  values: ParameterPresetValues;
  secretKeys?: Record<string, string>;
}

export interface StoredJobPresets {
  environmentId: string;
  jobUrl: string;
  presets: StoredParameterPreset[];
}
