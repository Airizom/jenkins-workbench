import { formatNumber } from "../../formatters/DisplayFormatters";
import type { JenkinsBuildAction, JenkinsBuildDetails } from "../../jenkins/types";
import { visitMatchingBuildParameters } from "../../shared/build/BuildParameterCollection";
import { formatBuildParameterValueForCompare } from "../../shared/build/BuildParameterFormatting";
import { forEachKeyedDiff } from "./BuildCompareDiff";
import type { BuildParameterRedactionOptions } from "./BuildCompareOptions";
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
  const baselineParameters = buildParameterMap(baselineDetails.actions, options);
  const targetParameters = buildParameterMap(targetDetails.actions, options);
  const items: BuildCompareParameterDiffItem[] = [];
  let unchangedCount = 0;

  forEachKeyedDiff(baselineParameters, targetParameters, {
    onAdded: (name, targetValue) => {
      items.push({ name, changeType: "added", targetValue: targetValue.displayValue });
    },
    onRemoved: (name, baselineValue) => {
      items.push({ name, changeType: "removed", baselineValue: baselineValue.displayValue });
    },
    onBoth: (name, baselineValue, targetValue) => {
      if (baselineValue.comparisonValue === targetValue.comparisonValue) {
        unchangedCount += 1;
        return;
      }
      items.push({
        name,
        changeType: "changed",
        baselineValue: baselineValue.displayValue,
        targetValue: targetValue.displayValue
      });
    }
  });

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
  options: BuildParameterRedactionOptions
): Map<string, NormalizedParameterValue> {
  const result = new Map<string, NormalizedParameterValue>();
  visitMatchingBuildParameters(
    actions,
    {
      allowList: options.allowList,
      denyList: options.denyList,
      maskPatterns: options.maskPatterns
    },
    (name, parameter, isMasked) => {
      const comparisonValue = formatBuildParameterValueForCompare(parameter);
      const displayValue = isMasked ? options.maskValue : comparisonValue;
      result.set(name, {
        comparisonValue,
        displayValue
      });
    }
  );
  return result;
}
