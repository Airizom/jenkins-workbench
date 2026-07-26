import type { IncomingHttpHeaders } from "node:http";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { normalizePosixRelativePath } from "../shared/posixPaths";
import { buildArtifactJobSegment, sanitizeEnvironmentSegment } from "./ArtifactPathUtils";

const INVALID_PATH_MESSAGE = "Artifact path is invalid and cannot be saved.";
const INVALID_ROOT_MESSAGE =
  "Artifact download location is invalid. Configure a workspace-relative folder with valid path component names.";
const WINDOWS_FORBIDDEN_PATH_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface ArtifactFilesystem {
  createDirectory(path: string): Thenable<void>;
  createWriteStream(filePath: string): NodeJS.WritableStream;
  delete(path: string): Thenable<void>;
}

export interface ArtifactDownloadRequest {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildNumber?: number;
  relativePath: string;
  fileName?: string;
  jobNameHint?: string;
  workspaceRoot: string;
  downloadRoot: string;
  maxBytes?: number;
}

export interface ArtifactDownloadResult {
  targetPath: string;
  headers: IncomingHttpHeaders;
  safeRelativePath: string;
  label: string;
}

export type ArtifactStorageErrorCode = "invalidPath" | "invalidRoot";

export class ArtifactStorageError extends Error {
  readonly code: ArtifactStorageErrorCode;

  constructor(code: ArtifactStorageErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class ArtifactStorageService {
  constructor(
    private readonly dataService: Pick<JenkinsDataService, "getArtifactStream">,
    private readonly filesystem: ArtifactFilesystem
  ) {}

  async downloadArtifact(request: ArtifactDownloadRequest): Promise<ArtifactDownloadResult> {
    const resolved = resolveArtifactTargetPath(request);

    const response = await this.dataService.getArtifactStream(
      request.environment,
      request.buildUrl,
      request.relativePath,
      { maxBytes: resolveMaxBytes(request.maxBytes) }
    );

    await this.filesystem.createDirectory(path.dirname(resolved.targetPath));
    const writeStream = this.filesystem.createWriteStream(resolved.targetPath);
    try {
      await pipeline(response.stream, writeStream);
    } catch (error) {
      await this.safeDelete(resolved.targetPath);
      throw error;
    }

    return {
      targetPath: resolved.targetPath,
      headers: response.headers,
      safeRelativePath: resolved.safeRelativePath,
      label: resolved.label
    };
  }

  private async safeDelete(targetPath: string): Promise<void> {
    try {
      await this.filesystem.delete(targetPath);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function resolveMaxBytes(value?: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return Number.POSITIVE_INFINITY;
}

function resolveArtifactTargetPath(request: ArtifactDownloadRequest): {
  targetPath: string;
  safeRelativePath: string;
  label: string;
} {
  const normalizedRelativePath = normalizePosixRelativePath(request.relativePath);
  if (!normalizedRelativePath) {
    throw new ArtifactStorageError("invalidPath", INVALID_PATH_MESSAGE);
  }
  const safeRelativePath = sanitizeArtifactRelativePath(normalizedRelativePath);

  const resolvedRoot = resolveDownloadRoot(request.workspaceRoot, request.downloadRoot);
  if (!resolvedRoot) {
    throw new ArtifactStorageError("invalidRoot", INVALID_ROOT_MESSAGE);
  }

  const buildSegment =
    typeof request.buildNumber === "number" && Number.isFinite(request.buildNumber)
      ? String(request.buildNumber)
      : "unknown";
  const environmentSegment = sanitizeEnvironmentSegment(request.environment);
  const jobSegment = buildArtifactJobSegment(request.buildUrl, request.jobNameHint);
  const targetRoot = path.resolve(resolvedRoot, environmentSegment, jobSegment, buildSegment);
  if (!isPathInside(resolvedRoot, targetRoot)) {
    throw new ArtifactStorageError("invalidRoot", INVALID_ROOT_MESSAGE);
  }

  const targetPath = path.resolve(targetRoot, ...safeRelativePath.split("/"));
  if (!isPathInside(targetRoot, targetPath)) {
    throw new ArtifactStorageError("invalidPath", INVALID_PATH_MESSAGE);
  }

  const label = request.fileName || path.basename(safeRelativePath) || safeRelativePath;
  return { targetPath, safeRelativePath, label };
}

function sanitizeArtifactRelativePath(relativePath: string): string {
  // On NTFS a ':' in a file name addresses an alternate data stream, so a
  // Jenkins-controlled artifact name like "report.txt:payload" would write hidden
  // content into the target root. Replace ':' with '_' (matching the '_' substitution
  // used for the surrounding directory segments) on every platform so downloads land
  // at the same path everywhere; POSIX names containing ':' are renamed accordingly.
  return relativePath.replace(/:/g, "_");
}

function resolveDownloadRoot(workspaceRoot: string, downloadRoot: string): string | undefined {
  const rootSegments = downloadRoot.replace(/\\/g, "/").split("/");
  if (
    !downloadRoot.trim() ||
    path.posix.isAbsolute(downloadRoot) ||
    path.win32.parse(downloadRoot).root !== "" ||
    rootSegments.includes("..") ||
    rootSegments.some((segment) => segment.length > 0 && !isWindowsCompatiblePathComponent(segment))
  ) {
    return undefined;
  }

  const normalized = normalizePosixRelativePath(downloadRoot);
  if (!normalized) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, ...normalized.split("/"));
  if (!isPathInside(workspaceRoot, resolved)) {
    return undefined;
  }
  return resolved;
}

function isWindowsCompatiblePathComponent(component: string): boolean {
  return (
    !WINDOWS_FORBIDDEN_PATH_CHARACTERS.test(component) &&
    ![...component].some((character) => character.charCodeAt(0) < 32) &&
    !component.endsWith(".") &&
    !component.endsWith(" ") &&
    !WINDOWS_RESERVED_PATH_COMPONENT.test(component)
  );
}

function isPathInside(rootPath: string, filePath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  if (!relative) {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
