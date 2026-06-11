import type { IncomingHttpHeaders } from "node:http";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { normalizePosixRelativePath } from "../shared/posixPaths";
import { buildArtifactJobSegment, sanitizeEnvironmentSegment } from "./ArtifactPathUtils";
import type { ArtifactRetrievalService } from "./ArtifactRetrievalService";

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
    private readonly retrievalService: ArtifactRetrievalService,
    private readonly filesystem: ArtifactFilesystem
  ) {}

  async downloadArtifact(request: ArtifactDownloadRequest): Promise<ArtifactDownloadResult> {
    const resolved = resolveArtifactTargetPath(request);

    const response = await this.retrievalService.getArtifactStream(
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
    throw new ArtifactStorageError("invalidPath", "Artifact path is invalid and cannot be saved.");
  }
  const safeRelativePath = sanitizeArtifactRelativePath(normalizedRelativePath);

  const resolvedRoot = resolveDownloadRoot(request.workspaceRoot, request.downloadRoot);
  if (!resolvedRoot) {
    throw new ArtifactStorageError(
      "invalidRoot",
      "Artifact download location is invalid. Check your Jenkins Workbench settings."
    );
  }

  const buildSegment =
    typeof request.buildNumber === "number" && Number.isFinite(request.buildNumber)
      ? String(request.buildNumber)
      : "unknown";
  const environmentSegment = sanitizeEnvironmentSegment(request.environment);
  const jobSegment = buildArtifactJobSegment(request.buildUrl, request.jobNameHint);
  const targetRoot = path.resolve(resolvedRoot, environmentSegment, jobSegment, buildSegment);
  if (!isPathInside(resolvedRoot, targetRoot)) {
    throw new ArtifactStorageError(
      "invalidRoot",
      "Artifact download location is invalid. Check your Jenkins Workbench settings."
    );
  }

  const targetPath = path.resolve(targetRoot, ...safeRelativePath.split("/"));
  if (!isPathInside(targetRoot, targetPath)) {
    throw new ArtifactStorageError("invalidPath", "Artifact path is invalid and cannot be saved.");
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
  return relativePath
    .split("/")
    .map((segment) => segment.replace(/:/g, "_"))
    .join("/");
}

function resolveDownloadRoot(workspaceRoot: string, downloadRoot: string): string | undefined {
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

function isPathInside(rootPath: string, filePath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  if (!relative || relative === "") {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
