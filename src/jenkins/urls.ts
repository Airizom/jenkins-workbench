import { collectAssignedLabelNames } from "./labels";
import type { JenkinsNode } from "./types";

export interface ParsedJobUrl {
  parentUrl: string;
  jobName: string;
  fullPath: string[];
}

export interface ParsedBuildUrl {
  jobUrl: string;
  buildNumber: number;
}

const BUILD_NUMBER_PATTERN = /^\d+$/;
const QUEUE_ITEM_ID_PATTERN = /^\d+$/;
const RELATIVE_URL_BASE = "https://jenkins.invalid/";
const AUTH_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "login",
  "loginentry",
  "loginerror",
  "securityrealm",
  "j_acegi_security_check",
  "j_security_check"
]);

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * Moves a stored URL from one of an environment's previous base URLs onto its new base.
 * The longest matching old base wins, so moving `https://h/jenkins/` up to `https://h/` still
 * rewrites `https://h/jenkins/job/a/`. Returns undefined when the URL needs no change: it belongs
 * to none of the old bases, or it already sits under the new base more specifically than under
 * any old base (which keeps `https://h/` -> `https://h/jenkins/` from double-prefixing).
 */
export function rebaseEnvironmentUrl(
  url: string,
  oldBases: readonly string[],
  newBase: string
): string | undefined {
  const target = ensureTrailingSlash(newBase);
  let source: string | undefined;
  for (const oldBase of oldBases) {
    const candidate = ensureTrailingSlash(oldBase);
    if (
      candidate !== target &&
      url.startsWith(candidate) &&
      candidate.length > (source?.length ?? -1)
    ) {
      source = candidate;
    }
  }
  if (!source || (url.startsWith(target) && target.length >= source.length)) {
    return undefined;
  }
  return target + url.slice(source.length);
}

/** Removes embedded `user:password@` credentials from a URL; other parts are kept as-is. */
export function stripUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) {
      return url;
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

export function normalizeJenkinsUrlForComparison(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = ensureTrailingSlash(url.pathname);
    return url.toString();
  } catch {
    return ensureTrailingSlash(value.split(/[?#]/, 1)[0] ?? value);
  }
}

export function parseQueueItemId(queueLocation?: string): number | undefined {
  if (!queueLocation || queueLocation.trim() !== queueLocation) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(queueLocation, RELATIVE_URL_BASE);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  if (
    pathParts.length < 3 ||
    pathParts[pathParts.length - 3] !== "queue" ||
    pathParts[pathParts.length - 2] !== "item"
  ) {
    return undefined;
  }

  const idPart = pathParts[pathParts.length - 1];
  if (!QUEUE_ITEM_ID_PATTERN.test(idPart)) {
    return undefined;
  }

  const queueItemId = Number(idPart);
  return Number.isSafeInteger(queueItemId) && queueItemId > 0 ? queueItemId : undefined;
}

function getContextPathLength(pathParts: readonly string[], environmentUrl?: string): number {
  if (!environmentUrl) {
    return 0;
  }
  try {
    const contextParts = new URL(environmentUrl).pathname
      .split("/")
      .filter((part) => part.length > 0);
    return contextParts.every((part, index) => pathParts[index] === part) ? contextParts.length : 0;
  } catch {
    return 0;
  }
}

function parseJobPathParts(
  pathParts: readonly string[],
  endExclusive = pathParts.length,
  startIndex = 0
): { firstJobIndex: number; segments: string[] } | undefined {
  let firstJobIndex = -1;
  for (let index = startIndex; index < endExclusive; index++) {
    if (pathParts[index] === "job") {
      firstJobIndex = index;
      break;
    }
  }

  if (firstJobIndex < 0) {
    return undefined;
  }

  const segments: string[] = [];
  for (let index = firstJobIndex; index < endExclusive; index++) {
    if (pathParts[index] === "job" && index + 1 < endExclusive) {
      try {
        segments.push(decodeURIComponent(pathParts[index + 1]));
      } catch {
        return undefined;
      }
      index++;
    }
  }

  return segments.length > 0 ? { firstJobIndex, segments } : undefined;
}

function appendJobPathSegments(baseUrl: string, segments: readonly string[]): string {
  let url = ensureTrailingSlash(baseUrl);
  for (let index = 0; index < segments.length; index++) {
    url += `job/${encodeURIComponent(segments[index])}/`;
  }
  return url;
}

export function parseJobUrl(jobUrl: string, environmentUrl?: string): ParsedJobUrl | undefined {
  let url: URL;
  try {
    url = new URL(jobUrl);
  } catch {
    return undefined;
  }
  const pathParts = url.pathname.split("/").filter((p) => p.length > 0);
  const parsedJobPath = parseJobPathParts(
    pathParts,
    pathParts.length,
    getContextPathLength(pathParts, environmentUrl)
  );
  if (!parsedJobPath) {
    return undefined;
  }

  const { firstJobIndex, segments } = parsedJobPath;
  const baseParts = pathParts.slice(0, firstJobIndex);
  const jobName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  const basePath = baseParts.length > 0 ? `/${baseParts.join("/")}` : "";
  const parentUrl = appendJobPathSegments(`${url.origin}${basePath}/`, parentSegments);

  return {
    parentUrl,
    jobName,
    fullPath: segments
  };
}

export function buildJobUrl(parentUrl: string, jobName: string): string {
  return appendJobPathSegments(parentUrl, [jobName]);
}

export function buildViewScopedJobUrl(
  viewUrl: string,
  jobUrl: string,
  environmentUrl?: string
): string {
  const parsed = parseJobUrl(jobUrl, environmentUrl);
  if (!parsed) {
    return jobUrl;
  }

  return appendJobPathSegments(viewUrl, parsed.fullPath);
}

export function canonicalizeJobUrlForEnvironment(
  environmentUrl: string,
  jobUrl: string
): string | undefined {
  const parsed = parseJobUrl(jobUrl, environmentUrl);
  if (!parsed) {
    return undefined;
  }

  return appendJobPathSegments(environmentUrl, parsed.fullPath);
}

export function parseBuildUrl(
  buildUrl: string,
  environmentUrl?: string
): ParsedBuildUrl | undefined {
  let url: URL;
  try {
    url = new URL(buildUrl);
  } catch {
    return undefined;
  }

  const pathParts = url.pathname.split("/").filter((part) => part.length > 0);
  const buildNumberPart = pathParts[pathParts.length - 1];
  if (!buildNumberPart || !BUILD_NUMBER_PATTERN.test(buildNumberPart)) {
    return undefined;
  }

  const buildNumber = Number.parseInt(buildNumberPart, 10);
  if (!Number.isFinite(buildNumber)) {
    return undefined;
  }

  const jobPathPartCount = pathParts.length - 1;
  if (pathParts[jobPathPartCount - 2] !== "job") {
    return undefined;
  }
  const parsedJobPath = parseJobPathParts(
    pathParts,
    jobPathPartCount,
    getContextPathLength(pathParts, environmentUrl)
  );
  if (url.origin === "null" || !parsedJobPath) {
    return undefined;
  }

  const jobPath =
    jobPathPartCount > 0 ? `/${pathParts.slice(0, jobPathPartCount).join("/")}/` : "/";
  const jobUrl = `${url.origin}${jobPath}`;

  return {
    jobUrl,
    buildNumber
  };
}

export function canonicalizeBuildUrlForEnvironment(
  environmentUrl: string,
  buildUrl: string
): string | undefined {
  const parsed = parseBuildUrl(buildUrl, environmentUrl);
  if (!parsed) {
    return undefined;
  }

  const canonicalJobUrl = canonicalizeJobUrlForEnvironment(environmentUrl, parsed.jobUrl);
  if (!canonicalJobUrl) {
    return undefined;
  }

  return new URL(`${parsed.buildNumber}/`, ensureTrailingSlash(canonicalJobUrl)).toString();
}

export function buildApiUrlFromBase(baseUrl: string, path: string, tree?: string): string {
  const base = ensureTrailingSlash(baseUrl);
  const url = new URL(path, base);
  if (tree) {
    url.searchParams.set("tree", tree);
  }
  return url.toString();
}

export function buildApiUrlFromItem(itemUrl: string, tree?: string): string {
  return buildApiUrlFromBase(itemUrl, "api/json", tree);
}

export function buildActionUrl(itemUrl: string, action: string): string {
  const base = ensureTrailingSlash(itemUrl);
  const url = new URL(action, base);
  return url.toString();
}

function encodePathSegments(path: string): string {
  const segments = path.split("/");
  let encodedSegmentCount = 0;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.length === 0) {
      continue;
    }
    if (segment === "." || segment === "..") {
      throw new Error("Relative paths cannot contain dot path segments.");
    }

    segments[encodedSegmentCount] = encodeURIComponent(segment);
    encodedSegmentCount++;
  }

  segments.length = encodedSegmentCount;
  return segments.join("/");
}

export function buildArtifactDownloadUrl(buildUrl: string, relativePath: string): string {
  const base = ensureTrailingSlash(buildUrl);
  const encodedPath = encodePathSegments(relativePath);
  return new URL(`artifact/${encodedPath}`, base).toString();
}

export function buildArtifactArchiveDownloadUrl(buildUrl: string): string {
  return new URL("artifact/*zip*/archive.zip", ensureTrailingSlash(buildUrl)).toString();
}

export function buildWorkspaceDirectoryListingUrl(jobUrl: string, relativePath?: string): string {
  const base = ensureTrailingSlash(jobUrl);
  const encodedPath = relativePath ? encodePathSegments(relativePath) : "";
  const workspacePath = encodedPath ? `ws/${encodedPath}/*plain*/` : "ws/*plain*/";
  return new URL(workspacePath, base).toString();
}

export function buildWorkspaceFileUrl(jobUrl: string, relativePath: string): string {
  const base = ensureTrailingSlash(jobUrl);
  const encodedPath = encodePathSegments(relativePath);
  return new URL(`ws/${encodedPath}`, base).toString();
}

export function resolveNodeUrl(baseUrl: string, node: JenkinsNode): string | undefined {
  const base = ensureTrailingSlash(baseUrl);
  let resolvedUrl: string | undefined;
  if (node.url) {
    try {
      resolvedUrl = new URL(node.url, base).toString();
    } catch {
      resolvedUrl = undefined;
    }
  }
  if (resolvedUrl) {
    return resolvedUrl;
  }

  if (node.name) {
    const nodePath = `computer/${encodeURIComponent(node.name)}/`;
    return new URL(nodePath, base).toString();
  }

  const labels = collectAssignedLabelNames(node.assignedLabels);

  if (labels.includes("built-in")) {
    return new URL("computer/(built-in)/", base).toString();
  }

  const displayName = node.displayName.trim();
  if (displayName.length > 0) {
    const match = labels.find((label) => label === displayName);
    if (match) {
      return new URL(`computer/${encodeURIComponent(match)}/`, base).toString();
    }
  }

  if (labels.length === 1) {
    return new URL(`computer/${encodeURIComponent(labels[0])}/`, base).toString();
  }

  return undefined;
}

export function isAuthRedirect(location: string, baseUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(location, baseUrl);
  } catch {
    return false;
  }
  const pathParts = target.pathname.split("/").filter((part) => part.length > 0);

  for (const part of pathParts.slice(getContextPathLength(pathParts, baseUrl))) {
    if (part === "job") {
      // Everything after the first job marker belongs to item names and item actions.
      return false;
    }
    if (AUTH_PATH_SEGMENTS.has(part.toLowerCase())) {
      return true;
    }
  }
  return false;
}
