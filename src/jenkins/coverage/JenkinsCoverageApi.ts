import type { JenkinsClientContext } from "../client/JenkinsClientContext";
import { JenkinsRequestError } from "../errors";
import { buildActionUrl } from "../urls";
import type { JenkinsCoverageOverview, JenkinsModifiedCoverageFile } from "./JenkinsCoverageTypes";

interface CoverageOverviewApiResponse {
  projectStatistics?: Record<string, unknown>;
  modifiedFilesStatistics?: Record<string, unknown>;
  modifiedLinesStatistics?: Record<string, unknown>;
  qualityGates?: {
    overallResult?: unknown;
    resultItems?: unknown;
  };
}

interface ModifiedCoverageApiResponse {
  files?: unknown;
}

export class JenkinsCoverageApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async discoverCoverageActionPath(buildUrl: string): Promise<string | undefined> {
    const html = await this.context.requestText(buildUrl);
    return parseCoverageActionPathFromBuildHtml(html, buildUrl);
  }

  async getCoverageOverview(
    buildUrl: string,
    actionPath = "coverage"
  ): Promise<JenkinsCoverageOverview | undefined> {
    const url = buildActionUrl(buildUrl, `${actionPath}/api/json`);
    try {
      const response = await this.context.requestJson<CoverageOverviewApiResponse>(url);
      return normalizeCoverageOverview(response);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }

  async getModifiedCoverageFiles(
    buildUrl: string,
    actionPath = "coverage"
  ): Promise<JenkinsModifiedCoverageFile[] | undefined> {
    const url = buildActionUrl(buildUrl, `${actionPath}/modified/api/json`);
    try {
      const response = await this.context.requestJson<ModifiedCoverageApiResponse>(url);
      return normalizeModifiedCoverageFiles(response);
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }
}

function normalizeCoverageOverview(
  response: CoverageOverviewApiResponse
): JenkinsCoverageOverview | undefined {
  const qualityGates = normalizeCoverageQualityGates(response.qualityGates?.resultItems);
  const projectCoverage = normalizeCoverageStatistic(response.projectStatistics);
  const modifiedFilesCoverage = normalizeCoverageStatistic(response.modifiedFilesStatistics);
  const modifiedLinesCoverage = normalizeCoverageStatistic(response.modifiedLinesStatistics);
  const overallQualityGateStatus = normalizeString(response.qualityGates?.overallResult);

  if (
    !projectCoverage &&
    !modifiedFilesCoverage &&
    !modifiedLinesCoverage &&
    !overallQualityGateStatus &&
    qualityGates.length === 0
  ) {
    return undefined;
  }

  return {
    projectCoverage,
    modifiedFilesCoverage,
    modifiedLinesCoverage,
    overallQualityGateStatus,
    qualityGates
  };
}

function normalizeCoverageStatistic(statistics?: Record<string, unknown>): string | undefined {
  if (!statistics) {
    return undefined;
  }

  const lineCoverage = normalizeCoverageValue(statistics.line);
  if (lineCoverage) {
    return lineCoverage;
  }

  for (const value of Object.values(statistics)) {
    const normalized = normalizeCoverageValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeCoverageQualityGates(value: unknown): JenkinsCoverageOverview["qualityGates"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const qualityGates: JenkinsCoverageOverview["qualityGates"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    const name = normalizeString(candidate.qualityGate);
    const status = normalizeString(candidate.result);
    if (!name || !status) {
      continue;
    }
    qualityGates.push({
      name,
      status,
      threshold: normalizeNumber(candidate.threshold),
      value: normalizeCoverageValue(candidate.value)
    });
  }
  return qualityGates;
}

function normalizeModifiedCoverageFiles(
  response: ModifiedCoverageApiResponse
): JenkinsModifiedCoverageFile[] | undefined {
  if (!Array.isArray(response.files)) {
    return undefined;
  }

  const files: JenkinsModifiedCoverageFile[] = [];
  for (const file of response.files) {
    if (!file || typeof file !== "object") {
      continue;
    }
    const candidate = file as Record<string, unknown>;
    const path = normalizeRelativePath(candidate.fullyQualifiedFileName);
    const blocks = normalizeModifiedCoverageBlocks(candidate.modifiedLinesBlocks);
    if (!path || blocks.length === 0) {
      continue;
    }
    files.push({ path, blocks });
  }

  return files.length > 0 ? files : undefined;
}

function normalizeModifiedCoverageBlocks(value: unknown): JenkinsModifiedCoverageFile["blocks"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const blocks: JenkinsModifiedCoverageFile["blocks"] = [];
  for (const block of value) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const candidate = block as Record<string, unknown>;
    const startLine = normalizePositiveInteger(candidate.startLine);
    const endLine = normalizePositiveInteger(candidate.endLine);
    const type = normalizeCoverageBlockType(candidate.type);
    if (!startLine || !endLine || !type || endLine < startLine) {
      continue;
    }
    blocks.push({ startLine, endLine, type });
  }
  return blocks;
}

function normalizeCoverageBlockType(
  value: unknown
): JenkinsModifiedCoverageFile["blocks"][number]["type"] | undefined {
  const normalized = normalizeString(value)?.toUpperCase();
  switch (normalized) {
    case "COVERED":
      return "covered";
    case "MISSED":
      return "missed";
    case "PARTIAL":
      return "partial";
    default:
      return undefined;
  }
}

function normalizeCoverageValue(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeRelativePath(value: unknown): string | undefined {
  const normalized = normalizeString(value)
    ?.replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCoverageActionPathFromBuildHtml(html: string, buildUrl: string): string | undefined {
  const match = html.match(/id="coverage-action-link-[^"]+"\s+href="([^"]+)"/i);
  if (!match?.[1]) {
    return undefined;
  }
  return normalizeCoverageActionHref(match[1], buildUrl);
}

function normalizeCoverageActionHref(href: string, buildUrl: string): string | undefined {
  const rawHref = href.trim();
  if (!rawHref) {
    return undefined;
  }

  try {
    const resolved = new URL(rawHref, buildUrl);
    const buildPath = ensureTrailingPathname(new URL(buildUrl).pathname);
    const resolvedPath = ensureTrailingPathname(resolved.pathname);
    if (!resolvedPath.startsWith(buildPath)) {
      return undefined;
    }
    const suffix = resolvedPath.slice(buildPath.length).replace(/^\/+|\/+$/g, "");
    return suffix || undefined;
  } catch {
    return normalizeRelativeActionPath(rawHref);
  }
}

function ensureTrailingPathname(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeRelativeActionPath(value: string): string | undefined {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const normalized = withoutQuery.replace(/^\/+|\/+$/g, "");
  return normalized || undefined;
}
