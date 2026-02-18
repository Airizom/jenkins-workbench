import type {
  JenkinsParameterDefinition,
  JenkinsPendingInputAction,
  JenkinsPendingInputParameterDefinition
} from "../JenkinsClient";
import type { JobParameter, JobParameterKind, PendingInputAction } from "./JenkinsDataTypes";

export function mapJobParameter(parameter: JenkinsParameterDefinition): JobParameter {
  const classification = classifyParameterKind(parameter.type, {
    choices: parameter.choices
  });

  return {
    name: parameter.name,
    kind: classification.kind,
    defaultValue: parameter.defaultValue,
    choices: parameter.choices,
    description: parameter.description,
    rawType: parameter.type,
    isSensitive: classification.isSensitive,
    runProjectName: parameter.projectName,
    multiSelectDelimiter: parameter.multiSelectDelimiter,
    allowsMultiple: classification.allowsMultiple
  };
}

export function mapPendingInputActions(actions: JenkinsPendingInputAction[]): PendingInputAction[] {
  const results: PendingInputAction[] = [];
  for (const action of actions) {
    const id = (action.id ?? action.inputId ?? "").trim();
    if (!id) {
      continue;
    }
    const message = (action.message ?? "").trim() || "Input required";
    const submitter = normalizeString(action.submitter);
    const proceedText = normalizeString(action.proceedText);
    const proceedUrl = normalizeString(action.proceedUrl);
    const abortUrl = normalizeString(action.abortUrl);
    const parameters = mapPendingInputParameters(action);
    results.push({
      id,
      message,
      submitter,
      proceedText,
      proceedUrl,
      abortUrl,
      parameters
    });
  }
  return results;
}

export function mapPendingInputParameters(action: JenkinsPendingInputAction): JobParameter[] {
  const rawParameters = Array.isArray(action.parameters)
    ? action.parameters
    : Array.isArray(action.inputs)
      ? action.inputs
      : [];
  const results: JobParameter[] = [];
  for (const parameter of rawParameters) {
    if (!parameter || !parameter.name) {
      continue;
    }
    results.push(mapPendingInputParameter(parameter));
  }
  return results;
}

export function mapPendingInputParameter(
  parameter: JenkinsPendingInputParameterDefinition
): JobParameter {
  const choices = Array.isArray(parameter.choices)
    ? parameter.choices.map((choice) => String(choice))
    : undefined;
  const classification = classifyParameterKind(parameter.type, {
    choices,
    includeLooseTokens: true
  });

  const rawDefault = parameter.defaultParameterValue?.value ?? parameter.defaultValue;
  const defaultValue = formatParameterDefaultValue(rawDefault);

  return {
    name: parameter.name ?? "parameter",
    kind: classification.kind,
    defaultValue,
    choices,
    description: parameter.description,
    rawType: parameter.type,
    isSensitive: classification.isSensitive,
    runProjectName: parameter.projectName,
    multiSelectDelimiter: parameter.multiSelectDelimiter,
    allowsMultiple: classification.allowsMultiple
  };
}

export function formatParameterDefaultValue(
  value: unknown
): string | number | boolean | string[] | undefined {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "undefined":
      return undefined;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.description ?? value.toString();
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "object":
      if (value === null) {
        return undefined;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => String(entry));
      }
      try {
        return JSON.stringify(value);
      } catch {
        return "[object]";
      }
    default:
      return undefined;
  }
}

export function classifyParameterKind(
  rawType: string | undefined,
  options?: { choices?: string[]; includeLooseTokens?: boolean }
): { kind: JobParameterKind; isSensitive: boolean; allowsMultiple: boolean } {
  const normalizedType = (rawType ?? "").toLowerCase();
  const hasChoices = Boolean(options?.choices && options.choices.length > 0);
  const includeLooseTokens = options?.includeLooseTokens === true;

  if (normalizedType.includes("credentialsparameterdefinition")) {
    return { kind: "credentials", isSensitive: true, allowsMultiple: false };
  }
  if (normalizedType.includes("runparameterdefinition")) {
    return { kind: "run", isSensitive: false, allowsMultiple: false };
  }
  if (normalizedType.includes("fileparameterdefinition")) {
    return { kind: "file", isSensitive: false, allowsMultiple: false };
  }
  if (normalizedType.includes("textparameterdefinition")) {
    return { kind: "text", isSensitive: false, allowsMultiple: false };
  }
  if (
    normalizedType.includes("extendedchoice") ||
    normalizedType.includes("multiselect") ||
    normalizedType.includes("multichoice")
  ) {
    return { kind: "multiChoice", isSensitive: false, allowsMultiple: true };
  }
  if (
    normalizedType.includes("booleanparameterdefinition") ||
    (includeLooseTokens && normalizedType.includes("boolean"))
  ) {
    return { kind: "boolean", isSensitive: false, allowsMultiple: false };
  }
  if (
    normalizedType.includes("choiceparameterdefinition") ||
    (includeLooseTokens && normalizedType.includes("choice")) ||
    hasChoices
  ) {
    return { kind: "choice", isSensitive: false, allowsMultiple: false };
  }
  if (
    normalizedType.includes("passwordparameterdefinition") ||
    (includeLooseTokens && normalizedType.includes("password"))
  ) {
    return { kind: "password", isSensitive: true, allowsMultiple: false };
  }
  return { kind: "string", isSensitive: false, allowsMultiple: false };
}

export function normalizeString(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
