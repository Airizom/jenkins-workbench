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
}

const DENSE_STRIP_THRESHOLD = 10;

// Lower index = worse outcome; unknown statuses sort with "neutral".
const STATUS_SEVERITY = ["failure", "unstable", "running", "aborted", "success", "neutral"];

type StageStatus = {
  statusClass: string;
  statusLabel: string;
};

function severityOf(statusClass: string): number {
  const index = STATUS_SEVERITY.indexOf(statusClass);
  return index === -1 ? STATUS_SEVERITY.length - 1 : index;
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

export function buildStageStripSegments(stages: PipelineStageViewModel[]): StageStripSegment[] {
  return stages.map((stage) => {
    // Jenkins usually rolls branch results into the parent stage; escalate only
    // when the parent reads as fine but a nested branch ended worse.
    let statusClass = stage.statusClass;
    let statusLabel = stage.statusLabel;
    if (statusClass === "success" || statusClass === "neutral") {
      const worst = worstBranchStatus(stage);
      if (severityOf(worst.statusClass) < severityOf(statusClass)) {
        statusClass = worst.statusClass;
        statusLabel = worst.statusLabel;
      }
    }
    return {
      key: stage.key,
      name: stage.name,
      statusClass,
      statusLabel,
      durationLabel: stage.durationLabel,
      branchCount: countBranches(stage),
      logTarget: stage.logTarget
    };
  });
}

export function isDenseStrip(segmentCount: number): boolean {
  return segmentCount > DENSE_STRIP_THRESHOLD;
}

function describeSegmentBranches(segment: StageStripSegment): string | undefined {
  if (segment.branchCount === 0) {
    return undefined;
  }
  return `${segment.branchCount} parallel ${segment.branchCount === 1 ? "branch" : "branches"}`;
}

export function describeSegmentAria(segment: StageStripSegment): string {
  const branches = describeSegmentBranches(segment);
  return `${segment.name}: ${segment.statusLabel}${branches ? `, ${branches}` : ""}`;
}

export function describeSegmentDetail(segment: StageStripSegment): string {
  const parts = [segment.statusLabel];
  if (segment.durationLabel && segment.durationLabel !== "—") {
    parts.push(segment.durationLabel);
  }
  const branches = describeSegmentBranches(segment);
  if (branches) {
    parts.push(branches);
  }
  return parts.join(" · ");
}

export function countFailedSegments(segments: StageStripSegment[]): number {
  return segments.filter((segment) => segment.statusClass === "failure").length;
}
