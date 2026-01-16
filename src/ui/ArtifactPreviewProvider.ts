import * as path from "node:path";
import * as vscode from "vscode";

export const ARTIFACT_PREVIEW_SCHEME = "jenkins-artifact";

const DEFAULT_MAX_PREVIEW_ENTRIES = 50;
const DEFAULT_MAX_PREVIEW_BYTES = 200 * 1024 * 1024;
const DEFAULT_PREVIEW_TTL_MS = 15 * 60 * 1000;

interface ArtifactPreviewEntry {
  data: Uint8Array;
  ctime: number;
  mtime: number;
  size: number;
  lastAccess: number;
  inUseCount: number;
}

export class ArtifactPreviewProvider implements vscode.FileSystemProvider {
  private readonly entries = new Map<string, ArtifactPreviewEntry>();
  private readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;
  private nextId = 0;
  private readonly maxEntries: number;
  private readonly maxTotalBytes: number;
  private readonly ttlMs: number;
  private totalBytes = 0;

  constructor(
    maxEntries = DEFAULT_MAX_PREVIEW_ENTRIES,
    maxTotalBytes = DEFAULT_MAX_PREVIEW_BYTES,
    ttlMs = DEFAULT_PREVIEW_TTL_MS
  ) {
    this.maxEntries = Math.max(1, maxEntries);
    this.maxTotalBytes = Math.max(1, maxTotalBytes);
    this.ttlMs = Math.max(1000, ttlMs);
  }

  registerArtifact(data: Uint8Array, fileName: string): vscode.Uri {
    const id = this.createId();
    const now = Date.now();
    const entry: ArtifactPreviewEntry = {
      data,
      ctime: now,
      mtime: now,
      size: data.byteLength,
      lastAccess: now,
      inUseCount: 0
    };
    this.entries.set(id, entry);
    this.totalBytes += entry.size;
    this.evictIfNeeded(now);

    const safeFileName = this.normalizeFileName(fileName);
    return vscode.Uri.from({
      scheme: ARTIFACT_PREVIEW_SCHEME,
      path: `/${id}/${safeFileName}`
    });
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const pathParts = this.getPathParts(uri);
    if (pathParts.length === 0) {
      const now = Date.now();
      return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
    }

    const entry = this.entries.get(pathParts[0]);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (pathParts.length === 1) {
      entry.lastAccess = Date.now();
      return { type: vscode.FileType.Directory, ctime: entry.ctime, mtime: entry.mtime, size: 0 };
    }

    entry.lastAccess = Date.now();
    return { type: vscode.FileType.File, ctime: entry.ctime, mtime: entry.mtime, size: entry.size };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const entry = this.getEntry(uri);
    entry.lastAccess = Date.now();
    return entry.data;
  }

  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(_uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions("Artifact previews are read-only.");
  }

  writeFile(
    _uri: vscode.Uri,
    _content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): void {
    throw vscode.FileSystemError.NoPermissions("Artifact previews are read-only.");
  }

  delete(_uri: vscode.Uri, _options: { recursive: boolean }): void {
    throw vscode.FileSystemError.NoPermissions("Artifact previews are read-only.");
  }

  rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { overwrite: boolean }
  ): void {
    throw vscode.FileSystemError.NoPermissions("Artifact previews are read-only.");
  }

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  private getEntry(uri: vscode.Uri): ArtifactPreviewEntry {
    const pathParts = this.getPathParts(uri);
    if (pathParts.length === 0) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const entry = this.entries.get(pathParts[0]);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  markInUse(uri: vscode.Uri): void {
    const entry = this.tryGetEntry(uri);
    if (!entry) {
      return;
    }
    entry.inUseCount += 1;
    entry.lastAccess = Date.now();
  }

  release(uri: vscode.Uri): void {
    const entry = this.tryGetEntry(uri);
    if (!entry) {
      return;
    }
    entry.inUseCount = Math.max(0, entry.inUseCount - 1);
    entry.lastAccess = Date.now();
    this.evictIfNeeded(entry.lastAccess);
  }

  private getPathParts(uri: vscode.Uri): string[] {
    const normalized = uri.path.replace(/^\/+/, "").trim();
    if (!normalized) {
      return [];
    }
    return normalized.split("/").filter((segment) => segment.length > 0);
  }

  private tryGetEntry(uri: vscode.Uri): ArtifactPreviewEntry | undefined {
    const pathParts = this.getPathParts(uri);
    if (pathParts.length === 0) {
      return undefined;
    }
    return this.entries.get(pathParts[0]);
  }

  private normalizeFileName(fileName: string): string {
    const baseName = path.basename(fileName.trim());
    if (baseName.length > 0) {
      return baseName;
    }
    return "artifact";
  }

  private createId(): string {
    this.nextId += 1;
    return `${Date.now().toString(36)}-${this.nextId}`;
  }

  private evictIfNeeded(now: number): void {
    this.purgeExpired(now);
    if (this.entries.size <= this.maxEntries && this.totalBytes <= this.maxTotalBytes) {
      return;
    }

    const candidates = this.getEvictionCandidates();
    for (const id of candidates) {
      if (this.entries.size <= this.maxEntries && this.totalBytes <= this.maxTotalBytes) {
        break;
      }
      this.deleteEntry(id);
    }
  }

  private purgeExpired(now: number): void {
    for (const [id, entry] of this.entries.entries()) {
      if (entry.inUseCount > 0) {
        continue;
      }
      if (now - entry.lastAccess > this.ttlMs) {
        this.deleteEntry(id);
      }
    }
  }

  private getEvictionCandidates(): string[] {
    const candidates: Array<{ id: string; lastAccess: number }> = [];
    for (const [id, entry] of this.entries.entries()) {
      if (entry.inUseCount > 0) {
        continue;
      }
      candidates.push({ id, lastAccess: entry.lastAccess });
    }
    candidates.sort((a, b) => a.lastAccess - b.lastAccess);
    return candidates.map((candidate) => candidate.id);
  }

  private deleteEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }
    this.totalBytes -= entry.size;
    this.entries.delete(id);
  }
}
