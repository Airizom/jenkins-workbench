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

export function buildOccurrenceKey(base: string, occurrence: number): string {
  return `${base}::${occurrence}`;
}

export function buildComparisonErrorDetail(
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

export function createCompareErrorSection<T>(
  summaryLabel: string,
  detail: string | undefined,
  fields: T
): T & { status: "error"; summaryLabel: string; detail?: string } {
  return {
    status: "error",
    summaryLabel,
    detail,
    ...fields
  };
}

export function createCompareUnavailableSection<T>(
  summaryLabel: string,
  detail: string | undefined,
  fields: T
): T & { status: "unavailable"; summaryLabel: string; detail?: string } {
  return {
    status: "unavailable",
    summaryLabel,
    detail,
    ...fields
  };
}

type StandardCompareSectionConfig<T, F, R> = {
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

export function evaluateStandardCompareSection<T, F, R>(
  baseline: BuildCompareOptionalResult<T>,
  target: BuildCompareOptionalResult<T>,
  config: StandardCompareSectionConfig<T, F, R>
): R {
  const resolveErrorFields = config.resolveErrorFields ?? (() => config.emptyFields);
  const resolvePartialFields = config.resolvePartialFields ?? (() => config.emptyFields);
  const bothUnavailableFields = config.bothUnavailableFields ?? config.emptyFields;

  return evaluateOptionalPair<T, R>(baseline, target, {
    onError: ({ baseline: baselineMessage, target: targetMessage }) =>
      createCompareErrorSection(
        config.errorSummaryLabel,
        buildComparisonErrorDetail(config.dataLabel, baselineMessage, targetMessage),
        resolveErrorFields(baseline, target)
      ) as R,
    onBothUnavailable: () =>
      createCompareUnavailableSection(
        config.unavailableSummaryLabel,
        config.bothUnavailableDetail,
        bothUnavailableFields
      ) as R,
    onPartialUnavailable: () =>
      createCompareUnavailableSection(
        config.unavailableSummaryLabel,
        config.partialUnavailableDetail,
        resolvePartialFields(baseline, target)
      ) as R,
    onAvailable: config.onAvailable
  });
}
