import type { PendingInputParameterViewModel } from "../../../shared/BuildDetailsContracts";

export function describePendingInputParameter(param: PendingInputParameterViewModel): string {
  const parts: string[] = [];
  if (param.description) {
    parts.push(param.description);
  }
  if (param.choices && param.choices.length > 0) {
    parts.push(`Choices: ${param.choices.join(", ")}`);
  }
  const defaultLabel = formatDefaultValue(param.defaultValue);
  if (defaultLabel) {
    parts.push(`Default: ${defaultLabel}`);
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return param.requiresBrowser
    ? "Entered on the Jenkins input page."
    : "You will be prompted for a value.";
}

function formatDefaultValue(value: PendingInputParameterViewModel["defaultValue"]): string {
  if (value === undefined || value === "") {
    return "";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}
