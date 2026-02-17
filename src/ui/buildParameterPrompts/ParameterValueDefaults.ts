import type { JobParameter } from "../../jenkins/JenkinsDataService";
import type { ParameterValue } from "./BuildParameterPromptTypes";

export function resolveSingleDefaultValue(
  presetValue: ParameterValue | undefined,
  parameterDefault: JobParameter["defaultValue"]
): string | undefined {
  if (typeof presetValue === "string") {
    return presetValue;
  }
  if (Array.isArray(presetValue)) {
    return presetValue[0];
  }
  if (typeof parameterDefault === "string") {
    return parameterDefault;
  }
  if (typeof parameterDefault === "number" || typeof parameterDefault === "boolean") {
    return String(parameterDefault);
  }
  if (Array.isArray(parameterDefault)) {
    return parameterDefault[0];
  }
  return undefined;
}

export function resolveMultiDefaultValue(
  presetValue: ParameterValue | undefined,
  parameterDefault: JobParameter["defaultValue"],
  delimiter?: string
): string[] {
  if (Array.isArray(presetValue)) {
    return presetValue;
  }
  if (typeof presetValue === "string") {
    return splitMultiValue(presetValue, delimiter);
  }
  if (Array.isArray(parameterDefault)) {
    return parameterDefault;
  }
  if (typeof parameterDefault === "string") {
    return splitMultiValue(parameterDefault, delimiter);
  }
  return [];
}

function splitMultiValue(value: string, delimiter?: string): string[] {
  const normalizedDelimiter = delimiter?.trim();
  if (normalizedDelimiter && normalizedDelimiter.length > 0) {
    return value
      .split(normalizedDelimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
