import { formatNumber } from "../../formatters/DisplayFormatters";
import { hasCoverageAction } from "../../jenkins/coverage/JenkinsCoverageActionPath";
import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { JenkinsBuildDetails } from "../../jenkins/types";
import { normalizeCoverageStatusClass } from "./CoverageStatusFormatters";
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

type CoverageContentFields = Pick<
  BuildDetailsCoverageStateViewModel,
  | "projectCoverage"
  | "modifiedFilesCoverage"
  | "modifiedLinesCoverage"
  | "overallQualityGateStatusLabel"
  | "overallQualityGateStatusClass"
  | "qualityGates"
  | "modifiedFiles"
  | "summaryOnly"
>;

export function buildCoverageStateViewModel(
  details: JenkinsBuildDetails | undefined,
  overview: JenkinsCoverageOverview | undefined,
  options?: BuildCoverageStateOptions
): BuildDetailsCoverageStateViewModel {
  const showTab = hasCoverageAction(details) || Boolean(options?.actionPath);
  if (!options?.enabled || details?.building) {
    return buildEmptyCoverageState("disabled", false);
  }

  if (options.loading) {
    return {
      status: "loading",
      showTab,
      ...buildCoverageContentFields(overview, options.modifiedFiles)
    };
  }

  if (!options.coverageFetched) {
    return buildEmptyCoverageState("idle", showTab);
  }

  if (options.error) {
    return {
      ...buildEmptyCoverageState("error", showTab),
      errorMessage: options.error
    };
  }

  const content = buildCoverageContentFields(overview, options.modifiedFiles);
  if (!hasCoverageContent(overview, content)) {
    return buildEmptyCoverageState("unavailable", showTab);
  }

  return {
    status: "available",
    showTab,
    ...content
  };
}

function buildEmptyCoverageState(
  status: Extract<
    BuildDetailsCoverageStateViewModel["status"],
    "disabled" | "idle" | "unavailable" | "error"
  >,
  showTab: boolean
): BuildDetailsCoverageStateViewModel {
  return {
    status,
    showTab,
    qualityGates: [],
    modifiedFiles: [],
    summaryOnly: false
  };
}

function buildCoverageContentFields(
  overview: JenkinsCoverageOverview | undefined,
  modifiedFiles?: JenkinsModifiedCoverageFile[]
): CoverageContentFields {
  const files = buildCoverageFileViewModel(modifiedFiles);
  const qualityGates = buildCoverageQualityGateViewModel(overview?.qualityGates);
  return {
    projectCoverage: overview?.projectCoverage,
    modifiedFilesCoverage: overview?.modifiedFilesCoverage,
    modifiedLinesCoverage: overview?.modifiedLinesCoverage,
    overallQualityGateStatusLabel: overview?.overallQualityGateStatus,
    overallQualityGateStatusClass: normalizeCoverageStatusClass(overview?.overallQualityGateStatus),
    qualityGates,
    modifiedFiles: files,
    summaryOnly: files.length === 0
  };
}

function hasCoverageContent(
  overview: JenkinsCoverageOverview | undefined,
  content: Pick<CoverageContentFields, "qualityGates" | "modifiedFiles">
): boolean {
  return (
    Boolean(overview?.projectCoverage) ||
    Boolean(overview?.modifiedFilesCoverage) ||
    Boolean(overview?.modifiedLinesCoverage) ||
    Boolean(overview?.overallQualityGateStatus) ||
    content.qualityGates.length > 0 ||
    content.modifiedFiles.length > 0
  );
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
    statusClass: normalizeCoverageStatusClass(qualityGate.status) ?? "neutral",
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

function formatCoverageThresholdLabel(threshold?: number, value?: string): string | undefined {
  if (typeof threshold !== "number") {
    return undefined;
  }

  const formatted = formatNumber(threshold);
  return value?.includes("%") ? `${formatted}%` : formatted;
}
