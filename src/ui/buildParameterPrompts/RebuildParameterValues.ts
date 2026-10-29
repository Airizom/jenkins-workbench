import { basename } from "node:path";
import type { JobParameter } from "../../jenkins/JenkinsDataService";
import { isRecord } from "../../shared/runtimeGuards";
import type { ParameterValue } from "./BuildParameterPromptTypes";
import { isSensitiveParameter } from "./ParameterSensitivity";
import { resolveMultiDefaultValue, resolveSingleDefaultValue } from "./ParameterValueDefaults";

/** Where an entry's seeded value came from. */
export type RebuildParameterStatus = "source" | "jobDefault" | "requiresInput";

export interface RebuildParameterEntry {
  parameter: JobParameter;
  status: RebuildParameterStatus;
  /** The value the source build recorded, after normalization. */
  sourceValue?: ParameterValue;
  /** The value the editor starts from; Reset restores it. */
  initialValue?: ParameterValue;
  /** The value to submit. `undefined` leaves the field out so Jenkins applies the job default. */
  value?: ParameterValue;
}

export interface RebuildParameterSeed {
  entries: RebuildParameterEntry[];
  /** Parameters the source build recorded that the job no longer defines. */
  droppedNames: string[];
}

const MAX_DISPLAY_LENGTH = 60;
const MASKED_VALUE = "••••";

/**
 * Seeds editor entries from the job's current parameter definitions and the values the source
 * build recorded. Jenkins doesn't export password values or uploaded files, so those must be
 * entered again.
 */
export function seedRebuildParameterValues(
  parameters: readonly JobParameter[],
  actions: ReadonlyArray<unknown | null> | null | undefined
): RebuildParameterSeed {
  const recorded = collectRecordedValues(actions);
  const definedNames = new Set(parameters.map((parameter) => parameter.name));

  const entries = parameters.map((parameter): RebuildParameterEntry => {
    const sourceValue = normalizeRecordedValue(parameter, recorded.get(parameter.name));
    const sensitive = isSensitiveParameter(parameter);

    if (
      parameter.kind === "file" ||
      parameter.kind === "password" ||
      (sensitive && typeof sourceValue !== "string")
    ) {
      return { parameter, status: "requiresInput", sourceValue };
    }

    if (sourceValue !== undefined) {
      return {
        parameter,
        status: "source",
        sourceValue,
        initialValue: sourceValue,
        value: sourceValue
      };
    }

    const defaultValue = resolveJobDefaultValue(parameter);
    return { parameter, status: "jobDefault", initialValue: defaultValue, value: defaultValue };
  });

  const droppedNames = [...recorded.keys()].filter((name) => !definedNames.has(name));
  return { entries, droppedNames };
}

export function isRebuildParameterPending(entry: RebuildParameterEntry): boolean {
  return entry.status === "requiresInput" && entry.value === undefined;
}

/** True when the value differs from the one the editor started from. */
export function isRebuildParameterEdited(entry: RebuildParameterEntry): boolean {
  return !areParameterValuesEqual(entry.value, entry.initialValue);
}

/** True when a recorded or default value was replaced; re-entered values don't count. */
export function isRebuildParameterChanged(entry: RebuildParameterEntry): boolean {
  return entry.status !== "requiresInput" && isRebuildParameterEdited(entry);
}

export function formatRebuildParameterValue(
  parameter: JobParameter,
  value: ParameterValue | undefined
): string {
  if (value === undefined) {
    return "(not set)";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "(none)";
    }
    return isSensitiveParameter(parameter) ? MASKED_VALUE : truncate(value.join(", "));
  }
  if (value.length === 0) {
    return "(empty)";
  }
  if (isSensitiveParameter(parameter)) {
    return MASKED_VALUE;
  }
  if (parameter.kind === "file") {
    return value.trim().length > 0 ? basename(value.trim()) : "(empty)";
  }
  const lines = value.split(/\r?\n/);
  const firstLine = lines[0] ?? "";
  return lines.length > 1 ? `${truncate(firstLine, MAX_DISPLAY_LENGTH - 1)}…` : truncate(firstLine);
}

function collectRecordedValues(
  actions: ReadonlyArray<unknown | null> | null | undefined
): Map<string, unknown> {
  const recorded = new Map<string, unknown>();
  for (const action of actions ?? []) {
    if (!isRecord(action) || !Array.isArray(action.parameters)) {
      continue;
    }
    for (const parameter of action.parameters) {
      if (!isRecord(parameter) || typeof parameter.name !== "string") {
        continue;
      }
      const name = parameter.name.trim();
      if (name.length > 0 && !recorded.has(name)) {
        recorded.set(name, parameter.value);
      }
    }
  }
  return recorded;
}

function normalizeRecordedValue(
  parameter: JobParameter,
  value: unknown
): ParameterValue | undefined {
  let normalized: ParameterValue | undefined;
  if (typeof value === "string") {
    normalized = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    normalized = String(value);
  } else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    normalized = value;
  }

  if (parameter.kind === "multiChoice" && typeof normalized === "string") {
    return resolveMultiDefaultValue(normalized, undefined, parameter.multiSelectDelimiter);
  }
  return normalized;
}

function resolveJobDefaultValue(parameter: JobParameter): ParameterValue | undefined {
  if (parameter.kind === "multiChoice") {
    return resolveMultiDefaultValue(
      undefined,
      parameter.defaultValue,
      parameter.multiSelectDelimiter
    );
  }
  return resolveSingleDefaultValue(undefined, parameter.defaultValue);
}

function areParameterValuesEqual(
  left: ParameterValue | undefined,
  right: ParameterValue | undefined
): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }
  return left === right;
}

function truncate(value: string, maxLength = MAX_DISPLAY_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
