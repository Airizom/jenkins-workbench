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

/**
 * How a multi-select value is submitted: joined with the parameter's delimiter when it has one,
 * otherwise one value per selection. An empty selection is submitted as an empty value.
 */
export function resolveMultiSelectSubmission(
  parameter: Pick<JobParameter, "multiSelectDelimiter">,
  values: readonly string[]
): string | string[] {
  if (values.length === 0) {
    return "";
  }
  const delimiter = parameter.multiSelectDelimiter;
  return delimiter ? values.join(delimiter) : [...values];
}

function splitMultiValue(value: string, delimiter?: string): string[] {
  const separator = delimiter || ",";
  return value
    .split(separator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
