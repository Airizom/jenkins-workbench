import { normalizeWhitespace } from "../stringValues";
import type { BuildParameterRecord } from "./BuildParameterCollection";

function stringifyParameterObject(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatBuildParameterValueForCompare(parameter: BuildParameterRecord): string {
  const value = parameter.value;
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return stringifyParameterObject(value);
  }
  if (typeof value === "undefined") {
    return "(undefined)";
  }
  return String(value);
}

export function formatBuildParameterValueForTooltip(value: unknown): string {
  switch (typeof value) {
    case "string":
      return normalizeWhitespace(value);
    case "number":
    case "boolean":
      return value.toString();
    case "bigint":
      return value.toString();
    case "symbol":
      return value.description ?? value.toString();
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "undefined":
      return "Unknown";
    case "object":
      if (value === null) {
        return "null";
      }
      return normalizeWhitespace(stringifyParameterObject(value));
    default:
      return "Unknown";
  }
}
