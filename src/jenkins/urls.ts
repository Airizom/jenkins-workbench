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

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function splitPathParts(pathname: string): string[] {
  const pathParts = pathname.split("/");
  let pathPartCount = 0;

  for (let index = 0; index < pathParts.length; index++) {
    const part = pathParts[index];
    if (part.length > 0) {
      pathParts[pathPartCount] = part;
      pathPartCount++;
    }
  }

  pathParts.length = pathPartCount;
  return pathParts;
}

function hasJobPathParts(pathParts: readonly string[], endExclusive = pathParts.length): boolean {
  let firstJobIndex = -1;
  for (let index = 0; index < endExclusive; index++) {
    if (pathParts[index] === "job") {
      firstJobIndex = index;
      break;
    }
  }

  if (firstJobIndex < 0) {
    return false;
  }

  let hasSegments = false;
  for (let index = firstJobIndex; index < endExclusive; index++) {
    if (pathParts[index] === "job" && index + 1 < endExclusive) {
      try {
        decodeURIComponent(pathParts[index + 1]);
      } catch {
        return false;
      }
      hasSegments = true;
      index++;
    }
  }

  return hasSegments;
}

function buildPathFromParts(pathParts: readonly string[], endExclusive: number): string {
  if (endExclusive <= 0) {
    return "";
  }

  let path = "";
  for (let index = 0; index < endExclusive; index++) {
    path += `/${pathParts[index]}`;
  }
  return path;
}

function appendJobPathSegments(baseUrl: string, segments: readonly string[]): string {
  let url = ensureTrailingSlash(baseUrl);
  for (let index = 0; index < segments.length; index++) {
    url += `job/${encodeURIComponent(segments[index])}/`;
  }
  return url;
}

export function parseJobUrl(jobUrl: string): ParsedJobUrl | undefined {
  let url: URL;
  try {
    url = new URL(jobUrl);
  } catch {
    return undefined;
  }
  const pathParts = url.pathname.split("/").filter((p) => p.length > 0);

  const firstJobIndex = pathParts.indexOf("job");

  if (firstJobIndex < 0) {
    return undefined;
  }

  const baseParts = pathParts.slice(0, firstJobIndex);
  const segments: string[] = [];
  for (let i = firstJobIndex; i < pathParts.length; i++) {
    if (pathParts[i] === "job" && i + 1 < pathParts.length) {
      try {
        segments.push(decodeURIComponent(pathParts[i + 1]));
      } catch {
        return undefined;
      }
      i++;
    }
  }

  if (segments.length === 0) {
    return undefined;
  }

  const jobName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  const basePath = baseParts.length > 0 ? `/${baseParts.join("/")}` : "";
  let parentPath = basePath;
  for (const segment of parentSegments) {
    parentPath += `/job/${encodeURIComponent(segment)}`;
  }

  const parentUrl = `${url.origin}${parentPath}/`;

  return {
    parentUrl,
    jobName,
    fullPath: segments
  };
}

export function buildJobUrl(parentUrl: string, jobName: string): string {
  const base = ensureTrailingSlash(parentUrl);
  return `${base}job/${encodeURIComponent(jobName)}/`;
}

export function buildViewScopedJobUrl(viewUrl: string, jobUrl: string): string {
  const parsed = parseJobUrl(jobUrl);
  if (!parsed) {
    return jobUrl;
  }

  return appendJobPathSegments(viewUrl, parsed.fullPath);
}

export function canonicalizeJobUrlForEnvironment(
  environmentUrl: string,
  jobUrl: string
): string | undefined {
  const parsed = parseJobUrl(jobUrl);
  if (!parsed) {
    return undefined;
  }

  return appendJobPathSegments(environmentUrl, parsed.fullPath);
}

export function parseBuildUrl(buildUrl: string): ParsedBuildUrl | undefined {
  let url: URL;
  try {
    url = new URL(buildUrl);
  } catch {
    return undefined;
  }

  const pathParts = splitPathParts(url.pathname);
  const buildNumberPart = pathParts[pathParts.length - 1];
  if (!buildNumberPart || !BUILD_NUMBER_PATTERN.test(buildNumberPart)) {
    return undefined;
  }

  const buildNumber = Number.parseInt(buildNumberPart, 10);
  if (!Number.isFinite(buildNumber)) {
    return undefined;
  }

  const jobPathPartCount = pathParts.length - 1;
  if (url.origin === "null" || !hasJobPathParts(pathParts, jobPathPartCount)) {
    return undefined;
  }

  const jobPath =
    jobPathPartCount > 0 ? `${buildPathFromParts(pathParts, jobPathPartCount)}/` : "/";
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
  const parsed = parseBuildUrl(buildUrl);
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
  const base = ensureTrailingSlash(itemUrl);
  const url = new URL("api/json", base);
  if (tree) {
    url.searchParams.set("tree", tree);
  }
  return url.toString();
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

export function buildWorkspaceDirectoryListingUrl(jobUrl: string, relativePath?: string): string {
  const base = ensureTrailingSlash(jobUrl);
  const workspacePath = relativePath
    ? `ws/${encodePathSegments(relativePath)}/*plain*/`
    : "ws/*plain*/";
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
  const path = target.pathname.toLowerCase();

  return (
    path.includes("/login") ||
    path.includes("/securityrealm") ||
    path.includes("/j_acegi_security_check") ||
    path.includes("/j_security_check")
  );
}
