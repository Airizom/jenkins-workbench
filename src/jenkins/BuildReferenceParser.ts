import { isJenkinsBuildPermalink, type JenkinsBuildPermalink } from "./types";
import {
  buildJobUrl,
  canonicalizeBuildUrlForEnvironment,
  canonicalizeJobUrlForEnvironment,
  ensureTrailingSlash,
  getContextPathLength,
  stripUrlCredentials
} from "./urls";

export type BuildReferenceInput =
  | { kind: "number"; buildNumber: number }
  | { kind: "url"; url: URL }
  | { kind: "invalid"; message: string };

export type ResolvedBuildReference =
  | { kind: "build"; buildUrl: string; jobUrl: string; buildNumber: number }
  | { kind: "permalink"; jobUrl: string; permalink: JenkinsBuildPermalink }
  | { kind: "job"; jobUrl: string }
  | { kind: "invalid"; message: string };

const NUMBER_LIKE_PATTERN = /^#?\s*[-+]?\d+(?:\.\d+)?$/;
const BUILD_NUMBER_PATTERN = /^\d+$/;
const BLUE_OCEAN_JOB_PAGES: ReadonlySet<string> = new Set(["activity", "branches", "pr"]);
const NOT_A_JOB_OR_BUILD = "That URL does not point to a Jenkins job or build.";

export function classifyBuildReference(input: string): BuildReferenceInput {
  const value = input.trim();
  if (value.length === 0) {
    return { kind: "invalid", message: "Enter a Jenkins build URL or build number." };
  }

  if (NUMBER_LIKE_PATTERN.test(value)) {
    const digits = value.replace(/^#\s*/, "");
    const buildNumber = parsePositiveBuildNumber(digits);
    return buildNumber === undefined
      ? { kind: "invalid", message: "Build numbers must be positive whole numbers." }
      : { kind: "number", buildNumber };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      kind: "invalid",
      message: "Enter a build number or an http(s) Jenkins URL."
    };
  }

  if (isHttpUrl(url)) {
    return { kind: "url", url: withoutCredentials(url) };
  }
  return { kind: "invalid", message: "Only http and https Jenkins URLs are supported." };
}

/**
 * Resolves a Jenkins URL on the matched environment to a canonical job/build reference rooted at
 * environmentUrl. Classic build sub-pages, view prefixes and Blue Ocean pages are folded away.
 */
export function resolveBuildReferenceUrl(url: URL, environmentUrl: string): ResolvedBuildReference {
  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  const contextLength = getContextPathLength(pathParts, environmentUrl);
  const parts = pathParts.slice(contextLength);
  if (parts[0] === "blue") {
    return resolveBlueOceanUrl(parts, environmentUrl);
  }
  return resolveClassicUrl(url, pathParts, contextLength, environmentUrl);
}

/** Display label such as "#42" for a build URL. */
export function formatBuildLabel(buildUrl: string): string | undefined {
  const match = buildUrl.match(/\/(\d+)\/?$/);
  return match ? `#${match[1]}` : undefined;
}

function resolveClassicUrl(
  url: URL,
  pathParts: readonly string[],
  contextLength: number,
  environmentUrl: string
): ResolvedBuildReference {
  const firstJobIndex = pathParts.indexOf("job", contextLength);
  if (firstJobIndex < 0 || firstJobIndex + 1 >= pathParts.length) {
    return { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  }

  const jobEnd = findJobPathEnd(pathParts, firstJobIndex);
  const jobPathUrl = `${url.origin}/${pathParts.slice(0, jobEnd).join("/")}/`;
  const jobUrl = canonicalizeJobUrlForEnvironment(environmentUrl, jobPathUrl);
  if (!jobUrl) {
    return { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  }

  const next = pathParts[jobEnd];
  const buildNumber = next === undefined ? undefined : parsePositiveBuildNumber(next);
  if (buildNumber !== undefined) {
    const buildUrl = canonicalizeBuildUrlForEnvironment(environmentUrl, `${jobPathUrl}${next}/`);
    return buildUrl
      ? { kind: "build", buildUrl, jobUrl, buildNumber }
      : { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  }
  if (next !== undefined && isJenkinsBuildPermalink(next)) {
    return { kind: "permalink", jobUrl, permalink: next };
  }
  return { kind: "job", jobUrl };
}

/**
 * Blue Ocean puts the whole folder path in one encoded segment (`team%2Fapp`) and names the
 * multibranch branch job after it. Each segment is decoded exactly once; the branch decodes to the
 * real job name (`feature%2Flogin` for branch feature/login) and is re-encoded as one job segment.
 */
function resolveBlueOceanUrl(
  parts: readonly string[],
  environmentUrl: string
): ResolvedBuildReference {
  if (parts[1] !== "organizations" || !parts[2] || !parts[3]) {
    return { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  }
  const pipelineSegments = decodeSegment(parts[3])
    ?.split("/")
    .filter((segment) => segment.length > 0);
  if (!pipelineSegments || pipelineSegments.length === 0) {
    return { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  }
  const pipelineJobUrl = toJobUrl(environmentUrl, pipelineSegments);

  const page = parts[4];
  if (page === undefined || BLUE_OCEAN_JOB_PAGES.has(page)) {
    return { kind: "job", jobUrl: pipelineJobUrl };
  }

  const branchOrJob = page === "detail" && parts[5] ? decodeSegment(parts[5]) : undefined;
  const buildNumber = parts[6] === undefined ? undefined : parsePositiveBuildNumber(parts[6]);
  if (!branchOrJob || buildNumber === undefined) {
    return { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  }

  // Known limitation: a branch named like its multibranch project (develop/develop) is
  // indistinguishable from a plain pipeline in the URL and resolves to the project itself.
  const jobUrl =
    branchOrJob === pipelineSegments[pipelineSegments.length - 1]
      ? pipelineJobUrl
      : buildJobUrl(pipelineJobUrl, branchOrJob);
  const buildUrl = new URL(`${buildNumber}/`, jobUrl).toString();
  return { kind: "build", buildUrl, jobUrl, buildNumber };
}

/**
 * Walks job/<name> pairs, skipping folder view/<name> pairs (which may nest) only when a job
 * follows them, and returns the index just past the last job name.
 */
function findJobPathEnd(pathParts: readonly string[], firstJobIndex: number): number {
  let jobEnd = firstJobIndex;
  let index = firstJobIndex;
  while (index + 1 < pathParts.length) {
    if (pathParts[index] === "job") {
      index += 2;
      jobEnd = index;
      continue;
    }
    const afterViews = skipViewPairs(pathParts, index);
    if (afterViews === index || pathParts[afterViews] !== "job") {
      break;
    }
    index = afterViews;
  }
  return jobEnd;
}

function skipViewPairs(pathParts: readonly string[], start: number): number {
  let index = start;
  while (pathParts[index] === "view" && index + 1 < pathParts.length) {
    index += 2;
  }
  return index;
}

function toJobUrl(environmentUrl: string, segments: readonly string[]): string {
  return segments.reduce(
    (parentUrl, segment) => buildJobUrl(parentUrl, segment),
    ensureTrailingSlash(environmentUrl)
  );
}

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function parsePositiveBuildNumber(value: string): number | undefined {
  if (!BUILD_NUMBER_PATTERN.test(value)) {
    return undefined;
  }
  const buildNumber = Number(value);
  return Number.isSafeInteger(buildNumber) && buildNumber > 0 ? buildNumber : undefined;
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function withoutCredentials(url: URL): URL {
  return url.username || url.password ? new URL(stripUrlCredentials(url.toString())) : url;
}
