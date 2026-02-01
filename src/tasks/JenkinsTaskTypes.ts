import type * as vscode from "vscode";
import { ensureTrailingSlash, parseJobUrl } from "../jenkins/urls";

export const JENKINS_TASK_TYPE = "jenkinsWorkbench";
export const JENKINS_TASK_SOURCE = "Jenkins Workbench";

export type JenkinsTaskParameterValue = string | number | boolean;
export type JenkinsTaskParameterValues =
  | JenkinsTaskParameterValue
  | JenkinsTaskParameterValue[];
export type JenkinsTaskParameters = Record<string, JenkinsTaskParameterValues>;

export interface JenkinsTaskParameterEntry {
  name: string;
  value: JenkinsTaskParameterValue;
}

export type JenkinsTaskRawParameters = JenkinsTaskParameters | JenkinsTaskParameterEntry[];

export interface JenkinsTaskDefinition extends vscode.TaskDefinition {
  type: typeof JENKINS_TASK_TYPE;
  environmentUrl: string;
  environmentId?: string;
  jobUrl: string;
  parameters?: JenkinsTaskRawParameters;
}

export interface NormalizedJenkinsTaskDefinition {
  type: typeof JENKINS_TASK_TYPE;
  environmentUrl: string;
  environmentId?: string;
  jobUrl: string;
  parameters?: JenkinsTaskRawParameters;
}

export interface TaskDefinitionResult {
  definition?: NormalizedJenkinsTaskDefinition;
  error?: string;
}

export interface TaskParametersResult {
  params?: URLSearchParams;
  allowEmptyParams: boolean;
  error?: string;
}

export function isJenkinsTaskDefinition(
  value: vscode.TaskDefinition
): value is JenkinsTaskDefinition {
  if (!value || value.type !== JENKINS_TASK_TYPE) {
    return false;
  }
  const record = value as Partial<JenkinsTaskDefinition>;
  return typeof record.environmentUrl === "string" && typeof record.jobUrl === "string";
}

export function normalizeTaskDefinition(definition: vscode.TaskDefinition): TaskDefinitionResult {
  if (definition.type !== JENKINS_TASK_TYPE) {
    return { error: "Invalid Jenkins task type." };
  }

  const environmentUrl =
    typeof (definition as JenkinsTaskDefinition).environmentUrl === "string"
      ? (definition as JenkinsTaskDefinition).environmentUrl.trim()
      : "";
  if (!environmentUrl) {
    return { error: "Jenkins tasks require an environmentUrl." };
  }

  const jobUrl =
    typeof (definition as JenkinsTaskDefinition).jobUrl === "string"
      ? (definition as JenkinsTaskDefinition).jobUrl.trim()
      : "";
  if (!jobUrl) {
    return { error: "Jenkins tasks require a jobUrl." };
  }

  const normalizedEnvironmentUrl = normalizeEnvironmentUrl(environmentUrl);
  if (!normalizedEnvironmentUrl) {
    return { error: "environmentUrl must be a valid http(s) URL." };
  }

  const normalizedJob = normalizeJobUrl(normalizedEnvironmentUrl, jobUrl);
  if (!normalizedJob.jobUrl) {
    return {
      error: normalizedJob.error ?? "jobUrl must be a valid Jenkins job URL."
    };
  }

  return {
    definition: {
      type: JENKINS_TASK_TYPE,
      environmentUrl: normalizedEnvironmentUrl,
      environmentId: normalizeOptionalString((definition as JenkinsTaskDefinition).environmentId),
      jobUrl: normalizedJob.jobUrl,
      parameters: (definition as JenkinsTaskDefinition).parameters
    }
  };
}

export function normalizeEnvironmentUrl(value: string): string | undefined {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return ensureTrailingSlash(parsed.toString());
  } catch {
    return undefined;
  }
}

export function normalizeJobUrl(
  environmentUrl: string,
  jobUrl: string
): { jobUrl?: string; error?: string } {
  const trimmed = normalizeOptionalString(jobUrl);
  if (!trimmed) {
    return { error: "jobUrl is required." };
  }

  const base = ensureTrailingSlash(environmentUrl);
  let resolved: URL;
  try {
    resolved = new URL(trimmed, base);
  } catch {
    return { error: "jobUrl must be a valid URL or a path relative to environmentUrl." };
  }

  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return { error: "jobUrl must use http or https." };
  }

  const normalized = ensureTrailingSlash(resolved.toString());
  if (!normalized.startsWith(base)) {
    return { error: "jobUrl must resolve within environmentUrl." };
  }

  if (!parseJobUrl(normalized)) {
    return { error: "jobUrl must point to a Jenkins job (missing /job/ segment)." };
  }

  return { jobUrl: normalized };
}

export function parseTaskParameters(parameters: unknown): TaskParametersResult {
  if (parameters === undefined || parameters === null) {
    return { allowEmptyParams: false };
  }

  const params = new URLSearchParams();
  const invalidKeys = new Set<string>();

  const appendValue = (key: string, value: unknown): void => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      params.append(key, String(value));
      return;
    }
    invalidKeys.add(key);
  };

  if (Array.isArray(parameters)) {
    for (const entry of parameters) {
      if (!entry || typeof entry !== "object") {
        invalidKeys.add("parameters");
        continue;
      }
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) {
        invalidKeys.add("parameters");
        continue;
      }
      appendValue(name, record.value);
    }
  } else if (typeof parameters === "object") {
    for (const [key, value] of Object.entries(parameters as Record<string, unknown>)) {
      const name = key.trim();
      if (!name) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          appendValue(name, entry);
        }
      } else {
        appendValue(name, value);
      }
    }
  } else {
    return {
      allowEmptyParams: true,
      error: "parameters must be an object or an array of name/value entries."
    };
  }

  if (invalidKeys.size > 0) {
    return {
      allowEmptyParams: true,
      error: `Invalid parameter values for: ${Array.from(invalidKeys).join(", ")}.`
    };
  }

  const hasParams = Array.from(params.keys()).length > 0;
  return { params: hasParams ? params : undefined, allowEmptyParams: true };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
