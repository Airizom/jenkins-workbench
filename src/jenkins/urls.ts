import { collectAssignedLabelNames } from "./labels";
import type { JenkinsNode } from "./types";

export interface ParsedJobUrl {
  parentUrl: string;
  jobName: string;
  fullPath: string[];
}

export function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
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
      segments.push(decodeURIComponent(pathParts[i + 1]));
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

export function encodePathSegments(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildArtifactDownloadUrl(buildUrl: string, relativePath: string): string {
  const base = ensureTrailingSlash(buildUrl);
  const encodedPath = encodePathSegments(relativePath);
  return new URL(`artifact/${encodedPath}`, base).toString();
}

export function buildArtifactViewUrl(buildUrl: string, relativePath: string): string {
  const base = ensureTrailingSlash(buildUrl);
  const encodedPath = encodePathSegments(relativePath);
  return new URL(`artifact/${encodedPath}/*view*/`, base).toString();
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
