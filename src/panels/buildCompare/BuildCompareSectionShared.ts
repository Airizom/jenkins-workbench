import type { JenkinsBuildDetails } from "../../jenkins/types";
import { formatBuildHeaderLabels } from "../../shared/build/BuildHeaderLabels";
import type { BuildCompareOptionalResult } from "./BuildCompareLoadState";
import { evaluateOptionalPair } from "./BuildCompareLoadState";
import type { BuildCompareBuildViewModel } from "./shared/BuildCompareContracts";

export function buildBuildViewModel(
  roleLabel: string,
  details: JenkinsBuildDetails
): BuildCompareBuildViewModel {
  const headerLabels = formatBuildHeaderLabels(details);
  return {
    roleLabel,
    displayName: details.fullDisplayName ?? details.displayName ?? roleLabel,
    buildUrl: details.url,
    ...headerLabels
  };
}

export { buildOccurrenceKey } from "../shared/TestCaseViewModel";

function buildComparisonErrorDetail(
  label: string,
  baselineMessage?: string,
  targetMessage?: string
): string {
  if (baselineMessage && targetMessage) {
    return `Baseline ${label.toLowerCase()}: ${baselineMessage} Target ${label.toLowerCase()}: ${targetMessage}`;
  }
  if (baselineMessage) {
    return `Baseline ${label.toLowerCase()}: ${baselineMessage}`;
  }
  if (targetMessage) {
    return `Target ${label.toLowerCase()}: ${targetMessage}`;
  }
  return `${label} comparison failed.`;
}

type StandardCompareFallbackSection<F> = F & {
  status: "error" | "unavailable";
  summaryLabel: string;
  detail?: string;
};

function createCompareSection<F extends object>(
  status: "error" | "unavailable",
  summaryLabel: string,
  detail: string | undefined,
  fields: F
): StandardCompareFallbackSection<F> {
  return {
    ...fields,
    status,
    summaryLabel,
    detail
  };
}

type StandardCompareSectionConfig<T, F extends object, R> = {
  dataLabel: string;
  errorSummaryLabel: string;
  unavailableSummaryLabel: string;
  bothUnavailableDetail: string;
  partialUnavailableDetail: string;
  emptyFields: F;
  bothUnavailableFields?: F;
  resolveErrorFields?: (
    baseline: BuildCompareOptionalResult<T>,
    target: BuildCompareOptionalResult<T>
  ) => F;
  resolvePartialFields?: (
    baseline: BuildCompareOptionalResult<T>,
    target: BuildCompareOptionalResult<T>
  ) => F;
  onAvailable: (baseline: T, target: T) => R;
};

export function evaluateStandardCompareSection<T, F extends object, R>(
  baseline: BuildCompareOptionalResult<T>,
  target: BuildCompareOptionalResult<T>,
  config: StandardCompareSectionConfig<T, F, R>
): R | StandardCompareFallbackSection<F> {
  const resolveErrorFields = config.resolveErrorFields ?? (() => config.emptyFields);
  const resolvePartialFields = config.resolvePartialFields ?? (() => config.emptyFields);
  const bothUnavailableFields = config.bothUnavailableFields ?? config.emptyFields;

  return evaluateOptionalPair<T, R | StandardCompareFallbackSection<F>>(baseline, target, {
    onError: ({ baseline: baselineMessage, target: targetMessage }) =>
      createCompareSection(
        "error",
        config.errorSummaryLabel,
        buildComparisonErrorDetail(config.dataLabel, baselineMessage, targetMessage),
        resolveErrorFields(baseline, target)
      ),
    onBothUnavailable: () =>
      createCompareSection(
        "unavailable",
        config.unavailableSummaryLabel,
        config.bothUnavailableDetail,
        bothUnavailableFields
      ),
    onPartialUnavailable: () =>
      createCompareSection(
        "unavailable",
        config.unavailableSummaryLabel,
        config.partialUnavailableDetail,
        resolvePartialFields(baseline, target)
      ),
    onAvailable: config.onAvailable
  });
}
