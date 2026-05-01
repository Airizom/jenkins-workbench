import { hasCoverageAction } from "../../jenkins/coverage/JenkinsCoverageActionPath";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { formatNumber } from "./BuildDetailsFormatters";
import type {
  BuildCoverageFileViewModel,
  BuildCoverageQualityGateViewModel,
  BuildDetailsCoverageStateViewModel
} from "./shared/BuildDetailsContracts";

export interface BuildCoverageStateOptions {
  modifiedFiles?: JenkinsModifiedCoverageFile[];
  actionPath?: string;
  coverageFetched?: boolean;
  loading?: boolean;
  error?: string;
  enabled?: boolean;
}

export function buildCoverageStateViewModel(
  details: JenkinsBuildDetails | undefined,
  overview: JenkinsCoverageOverview | undefined,
  options?: BuildCoverageStateOptions
): BuildDetailsCoverageStateViewModel {
  const showTab = hasCoverageAction(details) || Boolean(options?.actionPath);
  if (!options?.enabled || details?.building) {
    return {
      status: "disabled",
      showTab: false,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false
    };
  }

  if (options.loading) {
    return {
      status: "loading",
      showTab,
      projectCoverage: overview?.projectCoverage,
      modifiedFilesCoverage: overview?.modifiedFilesCoverage,
      modifiedLinesCoverage: overview?.modifiedLinesCoverage,
      overallQualityGateStatusLabel: overview?.overallQualityGateStatus,
      overallQualityGateStatusClass: formatCoverageStatusClass(overview?.overallQualityGateStatus),
      qualityGates: buildCoverageQualityGateViewModel(overview?.qualityGates),
      modifiedFiles: buildCoverageFileViewModel(options.modifiedFiles),
      summaryOnly: !options.modifiedFiles || options.modifiedFiles.length === 0
    };
  }

  if (!options.coverageFetched) {
    return {
      status: "idle",
      showTab,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false
    };
  }

  if (options.error) {
    return {
      status: "error",
      showTab,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false,
      errorMessage: options.error
    };
  }

  const modifiedFiles = buildCoverageFileViewModel(options.modifiedFiles);
  const qualityGates = buildCoverageQualityGateViewModel(overview?.qualityGates);
  const hasCoverage =
    Boolean(overview?.projectCoverage) ||
    Boolean(overview?.modifiedFilesCoverage) ||
    Boolean(overview?.modifiedLinesCoverage) ||
    Boolean(overview?.overallQualityGateStatus) ||
    qualityGates.length > 0 ||
    modifiedFiles.length > 0;

  if (!hasCoverage) {
    return {
      status: "unavailable",
      showTab,
      qualityGates: [],
      modifiedFiles: [],
      summaryOnly: false
    };
  }

  return {
    status: "available",
    showTab,
    projectCoverage: overview?.projectCoverage,
    modifiedFilesCoverage: overview?.modifiedFilesCoverage,
    modifiedLinesCoverage: overview?.modifiedLinesCoverage,
    overallQualityGateStatusLabel: overview?.overallQualityGateStatus,
    overallQualityGateStatusClass: formatCoverageStatusClass(overview?.overallQualityGateStatus),
    qualityGates,
    modifiedFiles,
    summaryOnly: modifiedFiles.length === 0
  };
}

function buildCoverageQualityGateViewModel(
  qualityGates?: JenkinsCoverageOverview["qualityGates"]
): BuildCoverageQualityGateViewModel[] {
  if (!qualityGates || qualityGates.length === 0) {
    return [];
  }

  return qualityGates.map((qualityGate) => ({
    name: qualityGate.name,
    statusLabel: qualityGate.status,
    statusClass: formatCoverageStatusClass(qualityGate.status) ?? "neutral",
    thresholdLabel: formatCoverageThresholdLabel(qualityGate.threshold, qualityGate.value),
    valueLabel: qualityGate.value
  }));
}

function buildCoverageFileViewModel(
  files?: JenkinsModifiedCoverageFile[]
): BuildCoverageFileViewModel[] {
  if (!files || files.length === 0) {
    return [];
  }

  return files
    .map((file) => ({
      path: file.path,
      coveredCount: countModifiedCoverageLines(file.blocks, "covered"),
      missedCount: countModifiedCoverageLines(file.blocks, "missed"),
      partialCount: countModifiedCoverageLines(file.blocks, "partial")
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function countModifiedCoverageLines(
  blocks: JenkinsModifiedCoverageFile["blocks"],
  type: JenkinsModifiedCoverageFile["blocks"][number]["type"]
): number {
  return blocks.reduce((total, block) => {
    if (block.type !== type) {
      return total;
    }
    return total + (block.endLine - block.startLine + 1);
  }, 0);
}

function formatCoverageStatusClass(status?: string): string | undefined {
  const normalized = status?.trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return "success";
    case "WARNING":
    case "UNSTABLE":
      return "warning";
    case "ERROR":
    case "FAILURE":
    case "FAILED":
      return "failure";
    default:
      return normalized ? "neutral" : undefined;
  }
}

function formatCoverageThresholdLabel(threshold?: number, value?: string): string | undefined {
  if (typeof threshold !== "number") {
    return undefined;
  }

  const formatted = formatNumber(threshold);
  return value?.includes("%") ? `${formatted}%` : formatted;
}
