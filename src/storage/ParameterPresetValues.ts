import type { ParameterPresetValues } from "./ParameterPresetTypes";

export function sanitizeParameterValues(values: unknown): ParameterPresetValues {
  const result: ParameterPresetValues = {};
  if (!values || typeof values !== "object") {
    return result;
  }

  for (const [key, rawValue] of Object.entries(values as Record<string, unknown>)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }
    if (typeof rawValue === "string") {
      result[normalizedKey] = rawValue;
      continue;
    }
    if (Array.isArray(rawValue)) {
      result[normalizedKey] = rawValue.map((entry) => String(entry));
    }
  }
  return result;
}

export function cloneParameterValues(values: ParameterPresetValues): ParameterPresetValues {
  const result: ParameterPresetValues = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = Array.isArray(value) ? [...value] : value;
  }
  return result;
}

export function parseStoredParameterValue(value: string): string | string[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") {
      return parsed;
    }
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry));
    }
    return undefined;
  } catch {
    return value;
  }
}
