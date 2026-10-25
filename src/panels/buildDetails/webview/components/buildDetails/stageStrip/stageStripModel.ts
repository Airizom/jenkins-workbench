import type {
  PipelineLogTargetViewModel,
  PipelineStageViewModel
} from "../../../../shared/BuildDetailsContracts";

export interface StageStripSegment {
  key: string;
  name: string;
  statusClass: string;
  statusLabel: string;
  durationLabel: string;
  branchCount: number;
  logTarget?: PipelineLogTargetViewModel;
  /** Running, but the build is paused on an input step. */
  paused?: boolean;
}

const PAUSED_STATUS_LABEL = "Waiting for input";

const DENSE_STRIP_THRESHOLD = 10;

// Lower index = worse outcome; success, neutral, and unknown statuses share the fallback rank.
const STATUS_SEVERITY = ["failure", "unstable", "running", "aborted"];

type StageStatus = {
  statusClass: string;
  statusLabel: string;
};

function severityOf(statusClass: string): number {
  const index = STATUS_SEVERITY.indexOf(statusClass);
  return index === -1 ? STATUS_SEVERITY.length : index;
}

function worstBranchStatus(stage: PipelineStageViewModel): StageStatus {
  let worst: StageStatus = {
    statusClass: stage.statusClass,
    statusLabel: stage.statusLabel
  };
  for (const branch of stage.parallelBranches) {
    const candidate = worstBranchStatus(branch);
    if (severityOf(candidate.statusClass) < severityOf(worst.statusClass)) {
      worst = candidate;
    }
  }
  return worst;
}

function countBranches(stage: PipelineStageViewModel): number {
  return stage.parallelBranches.reduce(
    (total, branch) => total + countBranches(branch),
    stage.parallelBranches.length
  );
}

/**
 * `awaitingInput` marks running segments as paused: Jenkins keeps reporting the
 * stage that holds an input step as in progress while the build waits.
 */
export function buildStageStripSegments(
  stages: PipelineStageViewModel[],
  awaitingInput = false
): StageStripSegment[] {
  return stages.map((stage) => {
    // Jenkins usually rolls branch results into the parent stage; escalate only
    // when the parent reads as fine but a nested branch ended worse.
    let statusClass = stage.statusClass;
    let statusLabel = stage.statusLabel;
    if (statusClass === "success" || statusClass === "neutral") {
      ({ statusClass, statusLabel } = worstBranchStatus(stage));
    }
    const paused = awaitingInput && statusClass === "running";
    return {
      key: stage.key,
      name: stage.name,
      statusClass,
      statusLabel: paused ? PAUSED_STATUS_LABEL : statusLabel,
      durationLabel: stage.durationLabel,
      branchCount: countBranches(stage),
      logTarget: stage.logTarget,
      ...(paused ? { paused } : {})
    };
  });
}

export function isDenseStrip(segmentCount: number): boolean {
  return segmentCount > DENSE_STRIP_THRESHOLD;
}

export function describeSegmentBranches(segment: StageStripSegment): string | undefined {
  if (segment.branchCount === 0) {
    return undefined;
  }
  return `${segment.branchCount} parallel ${segment.branchCount === 1 ? "branch" : "branches"}`;
}

/**
 * Stage name plus its parallel fan-out, e.g. "Tests · 3 parallel branches". The
 * strip only shows "×3" next to the name, so the tooltip and accessible name
 * spell the count out.
 */
export function describeSegmentTitle(segment: StageStripSegment): string {
  const branches = describeSegmentBranches(segment);
  return branches ? `${segment.name} · ${branches}` : segment.name;
}

export function describeSegmentAria(segment: StageStripSegment): string {
  return `${describeSegmentTitle(segment)}: ${segment.statusLabel}`;
}

export function describeSegmentDetail(segment: StageStripSegment): string {
  const parts = [segment.statusLabel];
  if (segment.durationLabel && segment.durationLabel !== "—") {
    parts.push(segment.durationLabel);
  }
  return parts.join(" · ");
}

/**
 * Key of the segment a clipped strip should scroll into view: the first
 * failure, otherwise the first stage still in progress.
 */
export function findAttentionSegmentKey(segments: StageStripSegment[]): string | undefined {
  return (
    segments.find((segment) => segment.statusClass === "failure") ??
    segments.find((segment) => segment.statusClass === "running")
  )?.key;
}

export function countFailedSegments(segments: StageStripSegment[]): number {
  return segments.filter((segment) => segment.statusClass === "failure").length;
}
