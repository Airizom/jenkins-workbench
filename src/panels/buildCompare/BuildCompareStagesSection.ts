import {
  type PipelineRun,
  type PipelineStage,
  toPipelineRun
} from "../../jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsWorkflowRun } from "../../jenkins/types";
import {
  formatDuration,
  formatNumber,
  normalizePipelineStatus
} from "../buildDetails/BuildDetailsFormatters";
import type { BuildCompareOptionalResult } from "./BuildCompareLoadState";
import { buildComparisonErrorDetail, normalizeString } from "./BuildCompareSectionShared";
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
  if (baselineWorkflowRun.status === "error" || targetWorkflowRun.status === "error") {
    return {
      status: "error",
      summaryLabel: "Pipeline timing unavailable",
      detail: buildComparisonErrorDetail(
        "Pipeline data",
        baselineWorkflowRun.status === "error" ? baselineWorkflowRun.message : undefined,
        targetWorkflowRun.status === "error" ? targetWorkflowRun.message : undefined
      ),
      items: []
    };
  }

  if (baselineWorkflowRun.status === "unavailable" && targetWorkflowRun.status === "unavailable") {
    return {
      status: "unavailable",
      summaryLabel: "Pipeline timing unavailable",
      detail: "Neither build exposed wfapi pipeline data.",
      items: []
    };
  }

  if (baselineWorkflowRun.status !== "available" || targetWorkflowRun.status !== "available") {
    return {
      status: "unavailable",
      summaryLabel: "Pipeline timing unavailable",
      detail: "Both builds need wfapi pipeline data for stage-by-stage timing comparison.",
      items: []
    };
  }

  const baselineStages = buildStageMap(toPipelineRun(baselineWorkflowRun.value));
  const targetStages = buildStageMap(toPipelineRun(targetWorkflowRun.value));
  const names = [...new Set([...baselineStages.keys(), ...targetStages.keys()])].sort();
  const items: BuildCompareStageDiffItem[] = names.map((name) => {
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
  });

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
  const name = normalizeString(stage.name) ?? "Stage";
  const path = [...parentPath, name];
  const pathLabel = path.join(" / ");
  const occurrence = occurrenceCounts.get(pathLabel) ?? 0;
  occurrenceCounts.set(pathLabel, occurrence + 1);
  const pathKey = buildStageOccurrenceKey(pathLabel, occurrence);
  const status = normalizePipelineStatus(stage.status);
  target.set(pathKey, {
    path: pathLabel,
    statusLabel: status.label,
    statusClass: status.className,
    durationLabel: formatDuration(stage.durationMillis),
    durationMs: stage.durationMillis
  });
  for (const branch of stage.parallelBranches) {
    collectStageEntries(branch, path, target, occurrenceCounts);
  }
}

function buildStageOccurrenceKey(path: string, occurrence: number): string {
  return `${path}::${occurrence}`;
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
  return `${prefix}${formatDuration(Math.abs(delta))}`;
}
