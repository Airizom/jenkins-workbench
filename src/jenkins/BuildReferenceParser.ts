import { isJenkinsBuildPermalink, type JenkinsBuildPermalink } from "./types";
import {
  buildJobUrl,
  ensureTrailingSlash,
  getContextPathLength,
  isProjectChildSegment,
  normalizeJenkinsUrlForComparison,
  parseClassicJobPath,
  publicJobRouteStart,
  resolveClassicJobPath,
  stripUrlCredentials
} from "./urls";

export type BuildReferenceInput =
  | { kind: "number"; buildNumber: number }
  | { kind: "url"; url: URL }
  | { kind: "invalid"; message: string };

interface NumberedRunReference {
  kind: "build";
  buildUrl: string;
  jobUrl: string;
  buildNumber: number;
}

export type ResolvedBuildReference =
  | NumberedRunReference
  | { kind: "permalink"; jobUrl: string; permalink: JenkinsBuildPermalink }
  | { kind: "job"; jobUrl: string }
  | { kind: "invalid"; message: string };

type ParsedBuildReference =
  | ResolvedBuildReference
  | {
      kind: "candidates";
      candidates: NumberedRunReference[];
      fallback?: Extract<ResolvedBuildReference, { kind: "job" | "permalink" }>;
    };

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
export function resolveBuildReferenceUrl(url: URL, environmentUrl: string): ParsedBuildReference {
  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  const contextLength = getContextPathLength(pathParts, environmentUrl);
  const parts = pathParts.slice(contextLength);
  if (parts[0] === "blue") {
    return resolveBlueOceanUrl(parts, environmentUrl);
  }
  return resolveClassicUrl(url, pathParts, environmentUrl);
}

/** Display label such as "#42" for a build URL. */
export function formatBuildLabel(buildUrl: string): string | undefined {
  const match = buildUrl.match(/\/(\d+)\/?$/);
  return match ? `#${match[1]}` : undefined;
}

function resolveClassicUrl(
  url: URL,
  pathParts: readonly string[],
  environmentUrl: string
): ParsedBuildReference {
  // A pasted URL below the configured base is a public endpoint. Only known,
  // contiguous job/view routes can discard their prefixes when sharing a build.
  const onController = normalizeJenkinsUrlForComparison(withoutCredentials(url).href).startsWith(
    normalizeJenkinsUrlForComparison(environmentUrl)
  );
  const configured = onController
    ? resolveClassicJobPath(url.origin, pathParts, environmentUrl, "configured")
    : undefined;
  let job = configured ?? resolveClassicJobPath(url.origin, pathParts, environmentUrl);
  const { publicViewAction, actionStart, viewMount } = findClassicAction(
    pathParts,
    environmentUrl,
    onController,
    configured,
    job
  );
  const fallbackJobUrl =
    publicViewAction && configured ? toJobUrl(environmentUrl, configured.segments) : undefined;
  if (actionStart !== undefined) {
    // Resolve the owning run before interpreting build subpages, which can
    // have numbers and job markers of their own (pipeline nodes, artifacts).
    const run = resolveActionRun(url, pathParts, actionStart, fallbackJobUrl);
    if (run) return run;
    if (!job || publicViewAction) job = findActionJob(pathParts, actionStart);
  }
  if (!job) return jobReference(fallbackJobUrl) ?? { kind: "invalid", message: NOT_A_JOB_OR_BUILD };
  const opaquePrefix = publicViewAction || (onController && !configured && !viewMount);
  return resolveClassicJobReference(url, pathParts, environmentUrl, job, {
    opaquePrefix,
    onController,
    fallbackJobUrl
  });
}

function findActionJob(parts: readonly string[], start: number) {
  const marker = parts.indexOf("job", start);
  return marker >= 0 ? parseClassicJobPath(parts, marker) : undefined;
}

function jobReference(jobUrl: string | undefined) {
  return jobUrl ? { kind: "job" as const, jobUrl } : undefined;
}

type ClassicJobPath = NonNullable<ReturnType<typeof resolveClassicJobPath>>;

function findClassicAction(
  pathParts: readonly string[],
  environmentUrl: string,
  onController: boolean,
  configured: ClassicJobPath | undefined,
  job: ClassicJobPath | undefined
) {
  const offset = getContextPathLength(pathParts, environmentUrl);
  const route = publicJobRouteStart(pathParts, offset);
  // The last job can own views, just as the controller can. Only contiguous
  // view/name pairs may precede the action that owns a custom run endpoint.
  const viewStart = configured?.jobEnd ?? route;
  let action = viewStart;
  while (action >= 0 && pathParts[action] === "view" && action + 1 < pathParts.length) {
    action += 2;
  }
  const viewMount = pathParts[offset] === "view" && job?.firstJobIndex === offset + 1;
  const publicViewAction =
    onController &&
    !viewMount &&
    action > viewStart &&
    action < pathParts.length - 1 &&
    !["job", "view", "queue", "ws", "artifact", "api"].includes(pathParts[action]);
  const controllerAction =
    onController &&
    route < 0 &&
    pathParts.length >= offset + 2 &&
    !["queue", "computer", "manage", "user", "me", "api", "ws", "artifact"].includes(
      pathParts[offset]
    );
  return {
    publicViewAction,
    viewMount,
    actionStart: publicViewAction ? action + 1 : controllerAction ? offset + 1 : undefined
  };
}

function resolveClassicJobReference(
  url: URL,
  pathParts: readonly string[],
  environmentUrl: string,
  job: ClassicJobPath,
  {
    opaquePrefix,
    onController,
    fallbackJobUrl
  }: {
    opaquePrefix: boolean;
    onController: boolean;
    fallbackJobUrl?: string;
  }
): ParsedBuildReference {
  const projectChild = pathParts[job.jobEnd];
  const jobEnd = projectChild && isProjectChildSegment(projectChild) ? job.jobEnd + 1 : job.jobEnd;
  const projectUrl = opaquePrefix
    ? `${url.origin}/${pathParts.slice(0, job.jobEnd).join("/")}/`
    : toJobUrl(environmentUrl, job.segments);
  const jobUrl = jobEnd > job.jobEnd ? `${projectUrl}${projectChild}/` : projectUrl;
  const next = pathParts[jobEnd];
  const buildNumber = next === undefined ? undefined : parsePositiveBuildNumber(next);
  if (buildNumber !== undefined) {
    if (opaquePrefix)
      return {
        kind: "candidates",
        candidates: [numberedEndpoint(url, pathParts.slice(0, jobEnd + 1), buildNumber)],
        fallback: jobReference(fallbackJobUrl)
      };
    return { kind: "build", buildUrl: `${jobUrl}${buildNumber}/`, jobUrl, buildNumber };
  }
  if (next !== undefined && isJenkinsBuildPermalink(next)) {
    return { kind: "permalink", jobUrl, permalink: next };
  }
  const fallback = fallbackJobUrl ?? jobUrl;
  const run = onController && resolveJobAction(url, pathParts, jobEnd, fallback);
  return run || { kind: "job", jobUrl: fallback };
}

function resolveJobAction(url: URL, parts: readonly string[], jobEnd: number, jobUrl: string) {
  const next = parts[jobEnd];
  if (
    !next ||
    jobEnd >= parts.length - 1 ||
    ["ws", "artifact", "queue", "api", "view", "job"].includes(next)
  )
    return undefined;
  return resolveActionRun(url, parts, jobEnd + 1, jobUrl);
}

/** A numeric plugin path segment can be a grouping page. Try numbered endpoints
 * from the outside in, stopping as soon as Jenkins confirms the owning run. */
function resolveActionRun(
  url: URL,
  parts: readonly string[],
  start: number,
  fallbackJobUrl?: string
): ParsedBuildReference | undefined {
  const candidates: NumberedRunReference[] = [];
  let nestedFallback: Extract<ResolvedBuildReference, { kind: "job" | "permalink" }> | undefined;
  for (let index = start; index < parts.length; ) {
    const step = readActionSegment(url, parts, index);
    if (step.fallback) nestedFallback = step.fallback;
    if (step.end === undefined) break;
    if (step.run) candidates.push(step.run);
    index = step.end;
  }
  if (candidates.length === 0) return nestedFallback;
  return {
    kind: "candidates",
    candidates,
    fallback: nestedFallback ?? jobReference(fallbackJobUrl)
  };
}

interface ActionPathStep {
  end?: number;
  run?: NumberedRunReference;
  fallback?: Extract<ResolvedBuildReference, { kind: "job" | "permalink" }>;
}

function readActionSegment(url: URL, parts: readonly string[], index: number): ActionPathStep {
  const segment = parts[index];
  if (segment === "job") {
    const job = readActionJob(url, parts, index);
    if (job?.fallback?.kind === "permalink") return { fallback: job.fallback };
    return job ?? {};
  }
  if (segment === "view") return { end: index + 2 };
  if (["ws", "artifact", "queue", "api"].includes(segment) || isJenkinsBuildPermalink(segment))
    return {};
  const number = parsePositiveBuildNumber(segment);
  return {
    end: index + 1,
    run: number === undefined ? undefined : numberedEndpoint(url, parts.slice(0, index + 1), number)
  };
}

function readActionJob(url: URL, parts: readonly string[], index: number) {
  const job = parseClassicJobPath(parts, index);
  if (!job) return undefined;
  const child = parts[job.jobEnd];
  const end = child && isProjectChildSegment(child) ? job.jobEnd + 1 : job.jobEnd;
  const jobUrl = `${url.origin}/${parts.slice(0, end).join("/")}/`;
  const next = parts[end];
  if (next && isJenkinsBuildPermalink(next))
    return { end, fallback: { kind: "permalink", jobUrl, permalink: next } as const };
  if (!next || !BUILD_NUMBER_PATTERN.test(next))
    return { end, fallback: { kind: "job", jobUrl } as const };
  return { end };
}

function numberedEndpoint(
  url: URL,
  parts: readonly string[],
  buildNumber: number
): NumberedRunReference {
  const jobUrl = `${url.origin}/${parts.slice(0, -1).join("/")}/`;
  return { kind: "build", buildUrl: `${jobUrl}${parts.at(-1)}/`, jobUrl, buildNumber };
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
