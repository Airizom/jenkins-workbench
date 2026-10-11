import * as path from "node:path";
import * as vscode from "vscode";
import {
  type NormalizedDiagnosticPathMapping,
  type NormalizedDiagnosticProfile,
  type RawBuildDiagnostic,
  serializePathMappings
} from "./BuildDiagnosticTypes";

const DEFAULT_SUFFIX_SEARCH_LIMIT = 200;
const DEFAULT_CACHE_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 2_000;

export type DiagnosticPathResolutionReason = "unsafe" | "missing" | "ambiguous" | "notFile";

export type DiagnosticPathResolution =
  | { status: "resolved"; uri: vscode.Uri; strategy: "mapping" | "direct" | "suffix" }
  | { status: "unresolved"; reason: DiagnosticPathResolutionReason; candidates?: number };

export interface BuildDiagnosticPathResolverOptions {
  suffixSearchLimit?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

interface DiagnosticPathCacheEntry<T> {
  pending: Promise<T>;
  expiresAt: number;
}

/** Resolves remote build paths without ever allowing a result outside the bound repository. */
export class BuildDiagnosticPathResolver {
  private readonly cache = new Map<string, DiagnosticPathCacheEntry<DiagnosticPathResolution>>();
  private readonly suffixCache = new Map<string, DiagnosticPathCacheEntry<readonly vscode.Uri[]>>();
  private readonly suffixSearchLimit: number;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private nextPruneAt = 0;

  constructor(options: BuildDiagnosticPathResolverOptions = {}) {
    this.suffixSearchLimit = Math.max(1, options.suffixSearchLimit ?? DEFAULT_SUFFIX_SEARCH_LIMIT);
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.now = options.now ?? Date.now;
  }

  clear(): void {
    this.cache.clear();
    this.suffixCache.clear();
    this.nextPruneAt = 0;
  }

  resolve(
    repositoryUri: vscode.Uri,
    profile: NormalizedDiagnosticProfile,
    diagnostic: Pick<RawBuildDiagnostic, "rawPath">
  ): Promise<DiagnosticPathResolution> {
    const key = `${repositoryUri.toString()}\0${profileResolutionKey(profile)}\0${diagnostic.rawPath}`;
    return this.resolveCached(this.cache, key, () =>
      this.resolveUncached(repositoryUri, profile, diagnostic.rawPath)
    );
  }

  private resolveCached<T>(
    cache: Map<string, DiagnosticPathCacheEntry<T>>,
    key: string,
    resolve: () => Promise<T>
  ): Promise<T> {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return cached.pending;
    }

    const now = this.now();
    this.pruneExpired(now);
    const pending = resolve();
    const entry: DiagnosticPathCacheEntry<T> = {
      pending,
      expiresAt: now + this.cacheTtlMs
    };
    cache.delete(key);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, entry);
    void pending.catch(() => {
      if (cache.get(key) === entry) {
        cache.delete(key);
      }
    });
    return pending;
  }

  /** Sweeps at most once per TTL so inserts stay amortized constant time. */
  private pruneExpired(now: number): void {
    if (now < this.nextPruneAt) {
      return;
    }
    this.nextPruneAt = now + this.cacheTtlMs;
    for (const cache of [this.cache, this.suffixCache]) {
      for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) {
          cache.delete(key);
        }
      }
    }
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
    if (mapped?.status === "resolved") {
      return mapped;
    }

    const direct = await this.resolveDirect(repositoryUri, normalizedRemotePath);
    if (direct?.status === "resolved") {
      return direct;
    }

    // An unsafe mapped or direct candidate, such as `../src/foo.c` from an
    // out-of-tree build, only means "not matched". The suffix search stays
    // inside the repository, so it may still find the file.
    const suffix = await this.resolveUniqueSuffix(
      repositoryUri,
      normalizedRemotePath,
      profile.searchExcludeGlob
    );
    if (suffix.status === "unresolved" && suffix.reason === "missing" && (mapped || direct)) {
      return { status: "unresolved", reason: "unsafe" };
    }
    return suffix;
  }

  private async resolveFromMappings(
    repositoryUri: vscode.Uri,
    normalizedRemotePath: string,
    mappings: readonly NormalizedDiagnosticPathMapping[]
  ): Promise<DiagnosticPathResolution | undefined> {
    let unsafe: DiagnosticPathResolution | undefined;
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
        unsafe ??= mapped;
      }
    }
    return unsafe;
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
    try {
      const reason = await inspectRepositoryFile(repositoryUri, candidate);
      if (reason) {
        return { status: "unresolved", reason };
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
    const key = JSON.stringify([repositoryUri.toString(), searchExcludeGlob, basename]);
    const matches = await this.resolveCached(this.suffixCache, key, async () => {
      const include = new vscode.RelativePattern(
        repositoryUri,
        `**/${escapeGlobSegment(basename)}`
      );
      const found = await vscode.workspace.findFiles(
        include,
        searchExcludeGlob || undefined,
        this.suffixSearchLimit + 1
      );
      // Preserve overflow before filtering so a partial search never implies uniqueness.
      return found.length > this.suffixSearchLimit
        ? found
        : collectSuffixFiles(repositoryUri, found);
    });
    if (matches.length > this.suffixSearchLimit) {
      return {
        status: "unresolved",
        reason: "ambiguous",
        candidates: matches.length
      };
    }
    return selectUniqueSuffix(
      matches
        .map((uri) => ({
          uri,
          suffixDepth: matchingSuffixDepth(relativeUriPath(repositoryUri, uri), remoteSegments)
        }))
        .filter((file) => file.suffixDepth > 0)
    );
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
  matches: readonly vscode.Uri[]
): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (const candidate of matches) {
    const file = await inspectSuffixCandidate(repositoryUri, candidate);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

async function inspectSuffixCandidate(
  repositoryUri: vscode.Uri,
  candidate: vscode.Uri
): Promise<vscode.Uri | undefined> {
  try {
    return (await inspectRepositoryFile(repositoryUri, candidate)) ? undefined : candidate;
  } catch {
    // A workspace search can race a deletion. Treat it as absent.
    return undefined;
  }
}

async function inspectRepositoryFile(
  repositoryUri: vscode.Uri,
  candidate: vscode.Uri
): Promise<DiagnosticPathResolutionReason | undefined> {
  if (!isUriInsideRepository(repositoryUri, candidate)) {
    return "unsafe";
  }
  const stat = await vscode.workspace.fs.stat(candidate);
  if ((stat.type & vscode.FileType.SymbolicLink) !== 0) {
    return "unsafe";
  }
  if ((stat.type & vscode.FileType.File) === 0) {
    return "notFile";
  }
  // The workspace filesystem API has no realpath operation. Reject links below
  // the bound root, including ancestors whose children stat as ordinary files.
  const segments = relativeUriPath(repositoryUri, candidate).split("/").filter(Boolean);
  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    const ancestor = vscode.Uri.joinPath(repositoryUri, ...segments.slice(0, depth));
    if (((await vscode.workspace.fs.stat(ancestor)).type & vscode.FileType.SymbolicLink) !== 0) {
      return "unsafe";
    }
  }
  return undefined;
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
    pathMappings: serializePathMappings(profile.pathMappings)
  });
}
