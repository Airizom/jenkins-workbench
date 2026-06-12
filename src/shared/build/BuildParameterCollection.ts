import { shouldIncludeBuildParameter, shouldMaskBuildParameter } from "./BuildParameterFilters";

export interface BuildParameterFilterOptions {
  allowList: readonly string[];
  denyList: readonly string[];
  maskPatterns: readonly string[];
}

export interface BuildParameterRecord {
  name?: unknown;
  value?: unknown;
}

interface BuildParameterAction {
  parameters?: unknown;
}

function normalizeBuildParameterName(name: unknown): string | undefined {
  if (typeof name !== "string") {
    return undefined;
  }
  const normalized = name.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isActionWithBuildParameters(
  action: unknown
): action is { parameters: BuildParameterRecord[] } {
  if (!action || typeof action !== "object") {
    return false;
  }
  return "parameters" in action && Array.isArray((action as BuildParameterAction).parameters);
}

export function visitMatchingBuildParameters(
  actions: ReadonlyArray<unknown | null> | null | undefined,
  options: BuildParameterFilterOptions,
  visitor: (name: string, parameter: BuildParameterRecord, isMasked: boolean) => void
): void {
  const seen = new Set<string>();

  for (const action of actions ?? []) {
    if (!isActionWithBuildParameters(action)) {
      continue;
    }

    for (const parameter of action.parameters) {
      const name = normalizeBuildParameterName(parameter.name);
      if (!name || seen.has(name)) {
        continue;
      }
      if (!shouldIncludeBuildParameter(name, options.allowList, options.denyList)) {
        continue;
      }
      seen.add(name);
      const isMasked = shouldMaskBuildParameter(name, options.maskPatterns);
      visitor(name, parameter, isMasked);
    }
  }
}
