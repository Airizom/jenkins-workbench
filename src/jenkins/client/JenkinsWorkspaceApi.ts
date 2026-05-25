import { normalizePosixRelativePath } from "../../shared/posixPaths";
import { JenkinsRequestError } from "../errors";
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
    const workspacePath = normalizeWorkspaceDirectoryPath(relativePath);
    const url = buildWorkspaceDirectoryListingUrl(jobUrl, workspacePath);
    const response = await this.context.requestText(url);
    return parseWorkspaceEntries(response, workspacePath);
  }

  async getWorkspaceFile(
    jobUrl: string,
    relativePath: string,
    options?: { maxBytes?: number }
  ): Promise<JenkinsBufferResponse> {
    const workspacePath = normalizeWorkspaceFilePath(relativePath);
    const url = buildWorkspaceFileUrl(jobUrl, workspacePath);
    return this.context.requestBufferWithHeaders(url, options);
  }
}

function normalizeWorkspaceDirectoryPath(value?: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return normalizeWorkspaceRequestPath(value);
}

function normalizeWorkspaceFilePath(value: string): string {
  return normalizeWorkspaceRequestPath(value);
}

function normalizeWorkspaceRequestPath(value: string): string {
  const normalized = normalizePosixRelativePath(value);
  if (!normalized) {
    throw new JenkinsRequestError("Invalid Jenkins workspace relative path.");
  }
  return normalized;
}

function parseWorkspaceEntries(
  listing: string,
  parentRelativePath?: string
): JenkinsWorkspaceEntry[] {
  const parentPath = normalizePosixRelativePath(parentRelativePath ?? "");
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
  const name = normalizePosixRelativePath(rawName);
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
    return normalizePosixRelativePath(childPath);
  }
  return normalizePosixRelativePath(`${parentPath}/${childPath}`);
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
