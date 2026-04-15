import type { JenkinsBufferResponse } from "../request";
import type { JenkinsWorkspaceEntry } from "../types";
import { buildWorkspaceDirectoryListingUrl, buildWorkspaceFileUrl } from "../urls";
import type { JenkinsClientContext } from "./JenkinsClientContext";

export class JenkinsWorkspaceApi {
  constructor(private readonly context: JenkinsClientContext) {}

  async getWorkspaceEntries(
    jobUrl: string,
    relativePath?: string
  ): Promise<JenkinsWorkspaceEntry[]> {
    const url = buildWorkspaceDirectoryListingUrl(jobUrl, relativePath);
    const response = await this.context.requestText(url);
    return parseWorkspaceEntries(response, relativePath);
  }

  async getWorkspaceFile(
    jobUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const url = buildWorkspaceFileUrl(jobUrl, relativePath);
    return this.context.requestBufferWithHeaders(url, options);
  }
}

function parseWorkspaceEntries(
  listing: string,
  parentRelativePath?: string
): JenkinsWorkspaceEntry[] {
  const parentPath = normalizeRelativePath(parentRelativePath);
  const entries: JenkinsWorkspaceEntry[] = [];

  for (const line of listing.split(/\r?\n/)) {
    const normalized = normalizeWorkspaceEntryLine(line, parentPath);
    if (!normalized) {
      continue;
    }
    entries.push(normalized);
  }

  entries.sort(compareWorkspaceEntries);
  return entries;
}

function normalizeWorkspaceEntryLine(
  line: string,
  parentRelativePath?: string
): JenkinsWorkspaceEntry | undefined {
  const entry = normalizeWorkspaceEntryName(line);
  if (!entry) {
    return undefined;
  }

  const relativePath = joinWorkspaceRelativePath(parentRelativePath, entry.name);
  if (!relativePath) {
    return undefined;
  }

  return {
    name: entry.name,
    relativePath,
    isDirectory: entry.isDirectory
  };
}

function normalizeWorkspaceEntryName(
  line: string
): { name: string; isDirectory: boolean } | undefined {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!normalizedLine) {
    return undefined;
  }

  const isDirectory = normalizedLine.endsWith("/");
  const rawName = isDirectory ? normalizedLine.slice(0, -1) : normalizedLine;
  const name = normalizeRelativePath(rawName);
  if (!name || name.includes("/")) {
    return undefined;
  }

  return { name, isDirectory };
}

function joinWorkspaceRelativePath(
  parentPath: string | undefined,
  childPath: string
): string | undefined {
  if (!parentPath) {
    return normalizeRelativePath(childPath);
  }
  return normalizeRelativePath(`${parentPath}/${childPath}`);
}

function normalizeRelativePath(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\\/g, "/").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized) {
    return undefined;
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

function compareWorkspaceEntries(
  left: JenkinsWorkspaceEntry,
  right: JenkinsWorkspaceEntry
): number {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}
