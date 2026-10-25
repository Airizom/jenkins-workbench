import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsStreamResponse } from "../jenkins/request";
import { normalizePosixRelativePath } from "../shared/posixPaths";
import { buildArtifactJobSegment, sanitizeEnvironmentSegment } from "./ArtifactPathUtils";

const INVALID_PATH_MESSAGE = "Artifact path is invalid and cannot be saved.";
const INVALID_ROOT_MESSAGE =
  "Artifact download location is invalid. Configure a workspace-relative folder with valid path component names.";
const WINDOWS_FORBIDDEN_PATH_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_PATH_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface ArtifactFilesystem {
  createDirectory(path: string, workspaceRoot: string): Thenable<void>;
  createWriteStream(filePath: string): NodeJS.WritableStream;
  rename(
    sourcePath: string,
    targetPath: string,
    workspaceRoot: string,
    signal?: AbortSignal
  ): Thenable<void>;
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

export interface ArtifactArchiveDownloadRequest
  extends Omit<ArtifactDownloadRequest, "relativePath" | "fileName"> {
  signal?: AbortSignal;
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
    private readonly dataService: Pick<
      JenkinsDataService,
      "getArtifactStream" | "getArtifactArchiveStream"
    >,
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

    return this.saveResponse(request, resolved, response);
  }

  async downloadAllArtifacts(
    request: ArtifactArchiveDownloadRequest
  ): Promise<ArtifactDownloadResult> {
    const targetRoot = resolveArtifactBuildRoot(request);
    const targetPath = `${targetRoot}.zip`;
    const label = path.basename(targetPath);
    request.signal?.throwIfAborted();
    const response = await this.dataService.getArtifactArchiveStream(
      request.environment,
      request.buildUrl,
      { maxBytes: resolveMaxBytes(request.maxBytes), signal: request.signal }
    );
    return this.saveResponse(
      request,
      { targetPath, safeRelativePath: label, label },
      response,
      request.signal
    );
  }

  private async saveResponse(
    request: Pick<ArtifactDownloadRequest, "workspaceRoot">,
    resolved: { targetPath: string; safeRelativePath: string; label: string },
    response: JenkinsStreamResponse,
    signal?: AbortSignal
  ): Promise<ArtifactDownloadResult> {
    const temporaryPath = path.join(
      path.dirname(resolved.targetPath),
      `.${path.basename(resolved.targetPath)}.${randomUUID()}.tmp`
    );
    try {
      signal?.throwIfAborted();
      await this.filesystem.createDirectory(
        path.dirname(resolved.targetPath),
        request.workspaceRoot
      );
      signal?.throwIfAborted();
      const writeStream = this.filesystem.createWriteStream(temporaryPath);
      await pipeline(response.stream, writeStream, { signal });
      signal?.throwIfAborted();
      await this.filesystem.rename(
        temporaryPath,
        resolved.targetPath,
        request.workspaceRoot,
        signal
      );
    } catch (error) {
      // Setup can fail before pipeline owns the response; release its socket either way.
      response.abort();
      await this.safeDelete(temporaryPath);
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

  const targetRoot = resolveArtifactBuildRoot(request);

  const targetPath = path.resolve(targetRoot, ...safeRelativePath.split("/"));
  if (!isPathInside(targetRoot, targetPath)) {
    throw new ArtifactStorageError("invalidPath", INVALID_PATH_MESSAGE);
  }

  const label = request.fileName || path.basename(safeRelativePath) || safeRelativePath;
  return { targetPath, safeRelativePath, label };
}

function resolveArtifactBuildRoot(request: ArtifactArchiveDownloadRequest): string {
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

  return targetRoot;
}

function sanitizeArtifactRelativePath(relativePath: string): string {
  // Encode NTFS alternate data stream separators on every platform. Escape literal
  // percent signs first so encoded names cannot collide with other artifact paths.
  return relativePath.replace(/%/g, "%25").replace(/:/g, "%3A");
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
