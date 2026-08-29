import * as path from "node:path";
import * as vscode from "vscode";
import type {
  NormalizedDiagnosticPathMapping,
  NormalizedDiagnosticProfile,
  RawBuildDiagnostic
} from "./BuildDiagnosticTypes";

const DEFAULT_SUFFIX_SEARCH_LIMIT = 200;
const DEFAULT_CACHE_TTL_MS = 5_000;

export type DiagnosticPathResolutionReason = "unsafe" | "missing" | "ambiguous" | "notFile";

export type DiagnosticPathResolution =
  | { status: "resolved"; uri: vscode.Uri; strategy: "mapping" | "direct" | "suffix" }
  | { status: "unresolved"; reason: DiagnosticPathResolutionReason; candidates?: number };

export interface BuildDiagnosticPathResolverOptions {
  suffixSearchLimit?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

interface DiagnosticPathCacheEntry {
  pending: Promise<DiagnosticPathResolution>;
  expiresAt: number;
}

/** Resolves remote build paths without ever allowing a result outside the bound repository. */
export class BuildDiagnosticPathResolver {
  private readonly cache = new Map<string, DiagnosticPathCacheEntry>();
  private readonly suffixSearchLimit: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(options: BuildDiagnosticPathResolverOptions = {}) {
    this.suffixSearchLimit = Math.max(1, options.suffixSearchLimit ?? DEFAULT_SUFFIX_SEARCH_LIMIT);
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.now = options.now ?? Date.now;
  }

  clear(): void {
    this.cache.clear();
  }

  resolve(
    repositoryUri: vscode.Uri,
    profile: NormalizedDiagnosticProfile,
    diagnostic: Pick<RawBuildDiagnostic, "rawPath">
  ): Promise<DiagnosticPathResolution> {
    const key = `${repositoryUri.toString()}\0${profileResolutionKey(profile)}\0${diagnostic.rawPath}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.pending;
    }

    const pending = this.resolveUncached(repositoryUri, profile, diagnostic.rawPath);
    const entry: DiagnosticPathCacheEntry = {
      pending,
      expiresAt: this.now() + this.cacheTtlMs
    };
    this.cache.set(key, entry);
    void pending.catch(() => {
      if (this.cache.get(key) === entry) {
        this.cache.delete(key);
      }
    });
    return pending;
  }

  private async resolveUncached(
    repositoryUri: vscode.Uri,
    profile: NormalizedDiagnosticProfile,
    rawPath: string
  ): Promise<DiagnosticPathResolution> {
    const normalizedRemotePath = normalizeRemotePath(rawPath);
    if (!normalizedRemotePath) {
      return { status: "unresolved", reason: "unsafe" };
    }

    const mapped = await this.resolveFromMappings(
      repositoryUri,
      normalizedRemotePath,
      profile.pathMappings
    );
    if (mapped) {
      return mapped;
    }

    const direct = await this.resolveDirect(repositoryUri, normalizedRemotePath);
    if (direct) {
      return direct;
    }

    return this.resolveUniqueSuffix(repositoryUri, normalizedRemotePath, profile.searchExcludeGlob);
  }

  private async resolveFromMappings(
    repositoryUri: vscode.Uri,
    normalizedRemotePath: string,
    mappings: readonly NormalizedDiagnosticPathMapping[]
  ): Promise<DiagnosticPathResolution | undefined> {
    for (const mapping of mappings) {
      const rewritten = rewriteMappedPath(mapping, normalizedRemotePath);
      if (typeof rewritten === "undefined") {
        continue;
      }
      const relativePath = joinRepositoryRelative(mapping.localRoot, rewritten);
      const mapped = await this.resolveExisting(repositoryUri, relativePath);
      if (mapped.status === "resolved") {
        return { ...mapped, strategy: "mapping" };
      }
      if (mapped.reason === "unsafe") {
        return mapped;
      }
    }
    return undefined;
  }

  private async resolveDirect(
    repositoryUri: vscode.Uri,
    normalizedRemotePath: string
  ): Promise<DiagnosticPathResolution | undefined> {
    if (isAbsoluteRemotePath(normalizedRemotePath)) {
      return undefined;
    }
    const direct = await this.resolveExisting(repositoryUri, normalizedRemotePath);
    if (direct.status === "resolved") {
      return { ...direct, strategy: "direct" };
    }
    return direct.reason === "unsafe" ? direct : undefined;
  }

  private async resolveExisting(
    repositoryUri: vscode.Uri,
    relativePath: string | undefined
  ): Promise<DiagnosticPathResolution> {
    const safeSegments = toSafeRelativeSegments(relativePath);
    if (!safeSegments) {
      return { status: "unresolved", reason: "unsafe" };
    }
    const candidate = vscode.Uri.joinPath(repositoryUri, ...safeSegments);
    if (!isUriInsideRepository(repositoryUri, candidate)) {
      return { status: "unresolved", reason: "unsafe" };
    }
    try {
      const stat = await vscode.workspace.fs.stat(candidate);
      if ((stat.type & vscode.FileType.File) === 0) {
        return { status: "unresolved", reason: "notFile" };
      }
      return { status: "resolved", uri: candidate, strategy: "direct" };
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
        return { status: "unresolved", reason: "missing" };
      }
      throw error;
    }
  }

  private async resolveUniqueSuffix(
    repositoryUri: vscode.Uri,
    normalizedRemotePath: string,
    searchExcludeGlob?: string
  ): Promise<DiagnosticPathResolution> {
    const remoteSegments = normalizedRemotePath.split("/").filter(Boolean);
    const basename = getSafeBasename(remoteSegments);
    if (!basename) {
      return { status: "unresolved", reason: "unsafe" };
    }
    const include = new vscode.RelativePattern(repositoryUri, `**/${escapeGlobSegment(basename)}`);
    const matches = await vscode.workspace.findFiles(
      include,
      searchExcludeGlob || undefined,
      this.suffixSearchLimit + 1
    );
    if (matches.length > this.suffixSearchLimit) {
      return {
        status: "unresolved",
        reason: "ambiguous",
        candidates: matches.length
      };
    }
    const files = await collectSuffixFiles(repositoryUri, matches, remoteSegments);
    return selectUniqueSuffix(files);
  }
}

function rewriteMappedPath(
  mapping: NormalizedDiagnosticPathMapping,
  normalizedRemotePath: string
): string | undefined {
  if (mapping.type === "prefix") {
    const prefix = normalizeRemotePath(mapping.remotePrefix);
    return prefix && hasPathPrefix(normalizedRemotePath, prefix)
      ? normalizedRemotePath.slice(prefix.length).replace(/^\/+/, "")
      : undefined;
  }
  mapping.regexp.lastIndex = 0;
  if (!mapping.regexp.test(normalizedRemotePath)) {
    return undefined;
  }
  mapping.regexp.lastIndex = 0;
  return normalizedRemotePath.replace(mapping.regexp, mapping.replacement);
}

function getSafeBasename(remoteSegments: readonly string[]): string | undefined {
  const basename = remoteSegments.at(-1);
  return basename && basename !== "." && basename !== ".." ? basename : undefined;
}

async function collectSuffixFiles(
  repositoryUri: vscode.Uri,
  matches: readonly vscode.Uri[],
  remoteSegments: readonly string[]
): Promise<Array<{ uri: vscode.Uri; suffixDepth: number }>> {
  const files: Array<{ uri: vscode.Uri; suffixDepth: number }> = [];
  for (const candidate of matches) {
    const file = await inspectSuffixCandidate(repositoryUri, candidate, remoteSegments);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

async function inspectSuffixCandidate(
  repositoryUri: vscode.Uri,
  candidate: vscode.Uri,
  remoteSegments: readonly string[]
): Promise<{ uri: vscode.Uri; suffixDepth: number } | undefined> {
  if (!isUriInsideRepository(repositoryUri, candidate)) {
    return undefined;
  }
  const relative = relativeUriPath(repositoryUri, candidate);
  const suffixDepth = matchingSuffixDepth(relative, remoteSegments);
  if (suffixDepth === 0) {
    return undefined;
  }
  try {
    const stat = await vscode.workspace.fs.stat(candidate);
    return (stat.type & vscode.FileType.File) !== 0 ? { uri: candidate, suffixDepth } : undefined;
  } catch {
    // A workspace search can race a deletion. Treat it as absent.
    return undefined;
  }
}

function selectUniqueSuffix(
  files: readonly { uri: vscode.Uri; suffixDepth: number }[]
): DiagnosticPathResolution {
  const bestSuffixDepth = Math.max(0, ...files.map((file) => file.suffixDepth));
  const bestMatches = files.filter((file) => file.suffixDepth === bestSuffixDepth);
  if (bestMatches.length === 1) {
    return { status: "resolved", uri: bestMatches[0].uri, strategy: "suffix" };
  }
  return {
    status: "unresolved",
    reason: bestMatches.length > 1 ? "ambiguous" : "missing",
    candidates: bestMatches.length
  };
}

function normalizeRemotePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.includes("\0") || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
    return undefined;
  }
  return trimmed.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function isAbsoluteRemotePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function hasPathPrefix(value: string, prefix: string): boolean {
  const normalizedPrefix = prefix.replace(/\/+$/, "");
  return value === normalizedPrefix || value.startsWith(`${normalizedPrefix}/`);
}

function joinRepositoryRelative(root: string, rewritten: string): string | undefined {
  const normalizedRewritten = normalizeRemotePath(rewritten);
  if (!normalizedRewritten || isAbsoluteRemotePath(normalizedRewritten)) {
    return undefined;
  }
  return path.posix.join(root.replace(/\\/g, "/"), normalizedRewritten);
}

function toSafeRelativeSegments(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (isAbsoluteRemotePath(normalized)) {
    return undefined;
  }
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return undefined;
  }
  return segments;
}

function isUriInsideRepository(repositoryUri: vscode.Uri, candidate: vscode.Uri): boolean {
  if (
    repositoryUri.scheme !== candidate.scheme ||
    repositoryUri.authority !== candidate.authority
  ) {
    return false;
  }
  const root = repositoryUri.path.replace(/\/+$/, "");
  return candidate.path === root || candidate.path.startsWith(`${root}/`);
}

function relativeUriPath(repositoryUri: vscode.Uri, candidate: vscode.Uri): string {
  const root = repositoryUri.path.replace(/\/+$/, "");
  return candidate.path.slice(root.length).replace(/^\/+/, "");
}

function matchingSuffixDepth(relativePath: string, remoteSegments: readonly string[]): number {
  const localSegments = relativePath.split("/").filter(Boolean);
  const max = Math.min(localSegments.length, remoteSegments.length);
  let matched = 0;
  for (let offset = 1; offset <= max; offset += 1) {
    if (localSegments.at(-offset) !== remoteSegments.at(-offset)) {
      break;
    }
    matched += 1;
  }
  return matched;
}

function escapeGlobSegment(value: string): string {
  return value.replace(/[[\]{}*?]/g, (character) => `[${character}]`);
}

function profileResolutionKey(profile: NormalizedDiagnosticProfile): string {
  return JSON.stringify({
    id: profile.id,
    searchExcludeGlob: profile.searchExcludeGlob,
    pathMappings: profile.pathMappings.map((mapping) =>
      mapping.type === "prefix"
        ? mapping
        : {
            type: mapping.type,
            pattern: mapping.pattern,
            replacement: mapping.replacement,
            localRoot: mapping.localRoot
          }
    )
  });
}
