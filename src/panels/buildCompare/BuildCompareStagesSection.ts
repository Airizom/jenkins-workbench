import { normalizePipelineStatus } from "../../formatters/BuildStatusFormatters";
import { formatNumber } from "../../formatters/DisplayFormatters";
import { formatDurationMs } from "../../formatters/DurationFormatters";
import {
  type PipelineRun,
  type PipelineStage,
  toPipelineRun
} from "../../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsWorkflowRun } from "../../jenkins/types";
import { trimToUndefined } from "../../shared/stringValues";
import { unionSortedMapKeys } from "./BuildCompareDiff";
import { type BuildCompareOptionalResult, evaluateOptionalPair } from "./BuildCompareLoadState";
import {
  buildComparisonErrorDetail,
  buildOccurrenceKey,
  createCompareErrorSection,
  createCompareUnavailableSection
} from "./BuildCompareSectionShared";
import type {
  BuildCompareStageDiffItem,
  BuildCompareStagesSectionViewModel
} from "./shared/BuildCompareContracts";

interface StageEntry {
  path: string;
  statusLabel: string;
  statusClass: string;
  durationLabel?: string;
  durationMs?: number;
}

export function buildStagesSection(
  baselineWorkflowRun: BuildCompareOptionalResult<JenkinsWorkflowRun>,
  targetWorkflowRun: BuildCompareOptionalResult<JenkinsWorkflowRun>
): BuildCompareStagesSectionViewModel {
  return evaluateOptionalPair(baselineWorkflowRun, targetWorkflowRun, {
    onError: ({ baseline, target }) =>
      createCompareErrorSection(
        "Pipeline timing unavailable",
        buildComparisonErrorDetail("Pipeline data", baseline, target),
        { items: [] }
      ),
    onBothUnavailable: () =>
      createCompareUnavailableSection(
        "Pipeline timing unavailable",
        "Neither build exposed wfapi pipeline data.",
        { items: [] }
      ),
    onPartialUnavailable: () =>
      createCompareUnavailableSection(
        "Pipeline timing unavailable",
        "Both builds need wfapi pipeline data for stage-by-stage timing comparison.",
        { items: [] }
      ),
    onAvailable: (baselineValue, targetValue) =>
      buildAvailableStagesSection(baselineValue, targetValue)
  });
}

function buildAvailableStagesSection(
  baselineValue: JenkinsWorkflowRun,
  targetValue: JenkinsWorkflowRun
): BuildCompareStagesSectionViewModel {
  const baselineStages = buildStageMap(toPipelineRun(baselineValue));
  const targetStages = buildStageMap(toPipelineRun(targetValue));
  const items: BuildCompareStageDiffItem[] = unionSortedMapKeys(baselineStages, targetStages).map(
    (name) => {
      const baseline = baselineStages.get(name);
      const target = targetStages.get(name);
      const displayName = baseline?.path ?? target?.path ?? name;
      if (!baseline && target) {
        return {
          name: displayName,
          changeType: "added",
          targetStatusLabel: target.statusLabel,
          targetStatusClass: target.statusClass,
          targetDurationLabel: target.durationLabel
        };
      }
      if (baseline && !target) {
        return {
          name: displayName,
          changeType: "removed",
          baselineStatusLabel: baseline.statusLabel,
          baselineStatusClass: baseline.statusClass,
          baselineDurationLabel: baseline.durationLabel
        };
      }
      return {
        name: displayName,
        changeType: "matched",
        baselineStatusLabel: baseline?.statusLabel,
        baselineStatusClass: baseline?.statusClass,
        targetStatusLabel: target?.statusLabel,
        targetStatusClass: target?.statusClass,
        baselineDurationLabel: baseline?.durationLabel,
        targetDurationLabel: target?.durationLabel,
        deltaLabel: formatDurationDelta(baseline?.durationMs, target?.durationMs)
      };
    }
  );

  return {
    status: items.length > 0 ? "available" : "empty",
    summaryLabel:
      items.length > 0
        ? `${formatNumber(items.length)} stage path${items.length === 1 ? "" : "s"} compared`
        : "No comparable pipeline stages",
    items
  };
}

function buildStageMap(run: PipelineRun | undefined): Map<string, StageEntry> {
  const result = new Map<string, StageEntry>();
  if (!run) {
    return result;
  }
  const occurrenceCounts = new Map<string, number>();
  for (const stage of run.stages) {
    collectStageEntries(stage, [], result, occurrenceCounts);
  }
  return result;
}

function collectStageEntries(
  stage: PipelineStage,
  parentPath: string[],
  target: Map<string, StageEntry>,
  occurrenceCounts: Map<string, number>
): void {
  const name = trimToUndefined(stage.name) ?? "Stage";
  const path = [...parentPath, name];
  const pathLabel = path.join(" / ");
  const occurrence = occurrenceCounts.get(pathLabel) ?? 0;
  occurrenceCounts.set(pathLabel, occurrence + 1);
  const pathKey = buildOccurrenceKey(pathLabel, occurrence);
  const status = normalizePipelineStatus(stage.status);
  target.set(pathKey, {
    path: pathLabel,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel: formatDurationMs(stage.durationMillis),
    durationMs: stage.durationMillis
  });
  for (const branch of stage.parallelBranches) {
    collectStageEntries(branch, path, target, occurrenceCounts);
  }
}

function formatDurationDelta(
  baselineDuration?: number,
  targetDuration?: number
): string | undefined {
  if (
    typeof baselineDuration !== "number" ||
    !Number.isFinite(baselineDuration) ||
    typeof targetDuration !== "number" ||
    !Number.isFinite(targetDuration)
  ) {
    return undefined;
  }
  const delta = targetDuration - baselineDuration;
  if (delta === 0) {
    return "No change";
  }
  const prefix = delta > 0 ? "+" : "-";
  return `${prefix}${formatDurationMs(Math.abs(delta))}`;
}
