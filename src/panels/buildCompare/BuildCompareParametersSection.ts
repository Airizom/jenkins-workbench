import type {
  JenkinsBuildAction,
  JenkinsBuildDetails,
  JenkinsBuildParameter
} from "../../jenkins/types";
import { formatNumber } from "../buildDetails/BuildDetailsFormatters";
import type { BuildParameterRedactionOptions } from "./BuildCompareOptions";
import { normalizeString } from "./BuildCompareSectionShared";
import type {
  BuildCompareParameterDiffItem,
  BuildCompareParametersSectionViewModel
} from "./shared/BuildCompareContracts";

interface NormalizedParameterValue {
  comparisonValue: string;
  displayValue: string;
}

export function buildParametersSection(
  baselineDetails: JenkinsBuildDetails,
  targetDetails: JenkinsBuildDetails,
  options: BuildParameterRedactionOptions
): BuildCompareParametersSectionViewModel {
  const baselineParameters = buildParameterMap(
    baselineDetails.actions,
    options.allowList,
    options.denyList,
    options.maskPatterns,
    options.maskValue
  );
  const targetParameters = buildParameterMap(
    targetDetails.actions,
    options.allowList,
    options.denyList,
    options.maskPatterns,
    options.maskValue
  );
  const names = [...new Set([...baselineParameters.keys(), ...targetParameters.keys()])].sort();
  const items: BuildCompareParameterDiffItem[] = [];
  let unchangedCount = 0;

  for (const name of names) {
    const baselineValue = baselineParameters.get(name);
    const targetValue = targetParameters.get(name);
    if (baselineValue?.comparisonValue === targetValue?.comparisonValue) {
      unchangedCount += 1;
      continue;
    }
    if (baselineValue === undefined) {
      items.push({ name, changeType: "added", targetValue: targetValue?.displayValue });
      continue;
    }
    if (targetValue === undefined) {
      items.push({ name, changeType: "removed", baselineValue: baselineValue.displayValue });
      continue;
    }
    items.push({
      name,
      changeType: "changed",
      baselineValue: baselineValue.displayValue,
      targetValue: targetValue.displayValue
    });
  }

  return {
    status: items.length > 0 ? "available" : "empty",
    summaryLabel:
      items.length > 0
        ? `${formatNumber(items.length)} changed parameter${items.length === 1 ? "" : "s"}`
        : "No parameter differences",
    detail:
      unchangedCount > 0
        ? `${formatNumber(unchangedCount)} parameters matched across both builds.`
        : undefined,
    items,
    unchangedCount
  };
}

function buildParameterMap(
  actions: Array<JenkinsBuildAction | null> | null | undefined,
  allowList: string[],
  denyList: string[],
  maskPatterns: string[],
  maskValue: string
): Map<string, NormalizedParameterValue> {
  const result = new Map<string, NormalizedParameterValue>();
  for (const action of actions ?? []) {
    if (!action || !("parameters" in action) || !Array.isArray(action.parameters)) {
      continue;
    }
    for (const parameter of action.parameters) {
      const name = normalizeString(parameter.name);
      if (!name || result.has(name)) {
        continue;
      }
      if (!shouldIncludeParameter(name, allowList, denyList)) {
        continue;
      }
      const comparisonValue = formatParameterValue(parameter);
      const displayValue = shouldMaskParameter(name, maskPatterns) ? maskValue : comparisonValue;
      result.set(name, {
        comparisonValue,
        displayValue
      });
    }
  }
  return result;
}

function shouldIncludeParameter(name: string, allowList: string[], denyList: string[]): boolean {
  if (allowList.length > 0 && !matchesAnyPattern(name, allowList)) {
    return false;
  }
  if (denyList.length > 0 && matchesAnyPattern(name, denyList)) {
    return false;
  }
  return true;
}

function shouldMaskParameter(name: string, maskPatterns: string[]): boolean {
  return matchesAnyPattern(name, maskPatterns);
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  const normalized = value.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern.toLowerCase()));
}

function formatParameterValue(parameter: JenkinsBuildParameter): string {
  const value = parameter.value;
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "undefined") {
    return "(undefined)";
  }
  return String(value);
}
