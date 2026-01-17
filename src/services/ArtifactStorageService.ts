import * as path from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import { pipeline } from "node:stream/promises";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ArtifactRetrievalService } from "./ArtifactRetrievalService";
import { buildArtifactJobSegment, sanitizeEnvironmentSegment } from "./ArtifactPathUtils";

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
  const safeRelativePath = normalizeArtifactRelativePath(request.relativePath);
  if (!safeRelativePath) {
    throw new ArtifactStorageError("invalidPath", "Artifact path is invalid and cannot be saved.");
  }

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

function resolveDownloadRoot(workspaceRoot: string, downloadRoot: string): string | undefined {
  const normalized = normalizeStorageRoot(downloadRoot);
  if (!normalized) {
    return undefined;
  }
  const resolved = path.resolve(workspaceRoot, ...normalized.split("/"));
  if (!isPathInside(workspaceRoot, resolved)) {
    return undefined;
  }
  return resolved;
}

function normalizeStorageRoot(value: string): string | undefined {
  const cleaned = value.replace(/\\/g, "/").trim();
  if (!cleaned) {
    return undefined;
  }
  const normalized = path.posix.normalize(cleaned);
  const withoutLeading = normalized.replace(/^\/+/g, "");
  const segments = withoutLeading
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    return undefined;
  }
  if (segments.some((segment) => segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

function normalizeArtifactRelativePath(relativePath: string): string | undefined {
  const cleaned = relativePath.replace(/\\/g, "/").trim();
  if (!cleaned) {
    return undefined;
  }
  const normalized = path.posix.normalize(cleaned);
  const withoutLeading = normalized.replace(/^\/+/g, "");
  const segments = withoutLeading
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    return undefined;
  }
  if (segments.some((segment) => segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

function isPathInside(rootPath: string, filePath: string): boolean {
  const relative = path.relative(rootPath, filePath);
  if (!relative || relative === "") {
    return true;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
