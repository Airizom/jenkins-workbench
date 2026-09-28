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
import { forEachKeyedDiff } from "./BuildCompareDiff";
import type { BuildCompareOptionalResult } from "./BuildCompareLoadState";
import { buildOccurrenceKey, evaluateStandardCompareSection } from "./BuildCompareSectionShared";
import type {
  BuildCompareStageDeltaDirection,
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
  return evaluateStandardCompareSection(baselineWorkflowRun, targetWorkflowRun, {
    dataLabel: "Pipeline data",
    errorSummaryLabel: "Pipeline timing unavailable",
    unavailableSummaryLabel: "Pipeline timing unavailable",
    bothUnavailableDetail: "Neither build exposed wfapi pipeline data.",
    partialUnavailableDetail:
      "Both builds need wfapi pipeline data for stage-by-stage timing comparison.",
    emptyFields: { items: [] },
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
  const items: BuildCompareStageDiffItem[] = [];

  forEachKeyedDiff(baselineStages, targetStages, {
    onAdded: (stageKey, target) => {
      items.push({
        key: stageKey,
        name: target.path,
        changeType: "added",
        targetStatusLabel: target.statusLabel,
        targetStatusClass: target.statusClass,
        targetDurationLabel: target.durationLabel
      });
    },
    onRemoved: (stageKey, baseline) => {
      items.push({
        key: stageKey,
        name: baseline.path,
        changeType: "removed",
        baselineStatusLabel: baseline.statusLabel,
        baselineStatusClass: baseline.statusClass,
        baselineDurationLabel: baseline.durationLabel
      });
    },
    onBoth: (stageKey, baseline, target) => {
      const delta = formatDurationDelta(baseline.durationMs, target.durationMs);
      items.push({
        key: stageKey,
        name: baseline.path,
        changeType: "matched",
        baselineStatusLabel: baseline.statusLabel,
        baselineStatusClass: baseline.statusClass,
        targetStatusLabel: target.statusLabel,
        targetStatusClass: target.statusClass,
        baselineDurationLabel: baseline.durationLabel,
        targetDurationLabel: target.durationLabel,
        deltaLabel: delta?.label,
        deltaDirection: delta?.direction,
        deltaSignificant: delta?.significant
      });
    }
  });

  return {
    status: items.length > 0 ? "available" : "empty",
    summaryLabel: items.length > 0 ? formatStagesSummary(items) : "No comparable pipeline stages",
    items
  };
}

function formatStagesSummary(items: BuildCompareStageDiffItem[]): string {
  const parts = [
    `${formatNumber(items.length)} stage path${items.length === 1 ? "" : "s"} compared`
  ];
  const slowerCount = countSignificantDeltas(items, "slower");
  const fasterCount = countSignificantDeltas(items, "faster");
  if (slowerCount > 0) {
    parts.push(`${formatNumber(slowerCount)} slower`);
  }
  if (fasterCount > 0) {
    parts.push(`${formatNumber(fasterCount)} faster`);
  }
  return parts.join(" · ");
}

function countSignificantDeltas(
  items: BuildCompareStageDiffItem[],
  direction: BuildCompareStageDeltaDirection
): number {
  return items.filter((item) => item.deltaSignificant && item.deltaDirection === direction).length;
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

/**
 * A timing delta only counts as a slowdown/speedup when it is large in both
 * absolute and relative terms; smaller swings are ordinary run-to-run noise.
 */
const STAGE_DELTA_MIN_MS = 15_000;
const STAGE_DELTA_MIN_RATIO = 0.1;

function isSignificantStageDelta(baselineDuration: number, deltaMs: number): boolean {
  const magnitude = Math.abs(deltaMs);
  if (magnitude < STAGE_DELTA_MIN_MS) {
    return false;
  }
  return baselineDuration <= 0 || magnitude / baselineDuration >= STAGE_DELTA_MIN_RATIO;
}

function formatDurationDelta(
  baselineDuration?: number,
  targetDuration?: number
):
  | { label: string; direction?: BuildCompareStageDeltaDirection; significant?: boolean }
  | undefined {
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
    return { label: "No change" };
  }
  const prefix = delta > 0 ? "+" : "-";
  return {
    label: `${prefix}${formatDurationMs(Math.abs(delta))}`,
    direction: delta > 0 ? "slower" : "faster",
    significant: isSignificantStageDelta(baselineDuration, delta)
  };
}
