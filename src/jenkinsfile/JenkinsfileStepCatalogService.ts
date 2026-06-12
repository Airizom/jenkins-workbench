import type * as vscode from "vscode";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileEnvironmentResolver } from "../validation/JenkinsfileEnvironmentResolver";
import { FALLBACK_JENKINSFILE_STEP_CATALOG } from "./JenkinsfileFallbackCatalog";
import { parseJenkinsfileGdsl } from "./JenkinsfileGdslParser";
import type {
  JenkinsfileStepCatalog,
  JenkinsfileStepCatalogResult
} from "./JenkinsfileIntelligenceTypes";
import { mergeStepCatalogs } from "./JenkinsfileStepCatalogUtils";

interface CacheEntry {
  catalog: JenkinsfileStepCatalog;
  expiresAt: number;
}

interface LoadErrorEntry {
  error: Error;
  retryAfter: number;
}

interface CatalogLoadContext {
  allGeneration: number;
  environmentGeneration: number;
  environmentKey: string;
}

interface InFlightLoad {
  context: CatalogLoadContext;
  id: number;
  promise: Promise<JenkinsfileStepCatalog>;
}

type JenkinsfileCatalogEnvironmentKey = Pick<JenkinsEnvironmentRef, "scope" | "environmentId">;

const STEP_CATALOG_TTL_MS = 15 * 60 * 1000;
const STEP_CATALOG_RETRY_BACKOFF_MS = 30 * 1000;

interface JenkinsfileStepCatalogInvalidationSurface {
  invalidateAll(): void;
}

export class JenkinsfileStepCatalogService implements JenkinsfileStepCatalogInvalidationSurface {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightLoad>();
  private readonly loadErrors = new Map<string, LoadErrorEntry>();
  private readonly environmentGenerations = new Map<string, number>();
  private allGeneration = 0;
  private nextLoadId = 0;

  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    private readonly environmentResolver: JenkinsfileEnvironmentResolver
  ) {}

  async getCatalogForDocument(
    document: vscode.TextDocument
  ): Promise<JenkinsfileStepCatalogResult> {
    const environment = await this.environmentResolver.resolveForDocumentSilently(document);
    if (!environment) {
      return createFallbackNoEnvironmentResult();
    }

    const authSignature = await this.clientProvider.getAuthSignature(environment);
    const key = buildCacheKey(environment, authSignature);
    const cached = this.cache.get(key);
    const loadError = this.loadErrors.get(key);
    if (cached) {
      if (cached.expiresAt <= Date.now() && shouldRetryAfterLoadError(loadError)) {
        this.ensureCatalogLoaded(environment, key);
      }
      return createLiveResult(cached.catalog, environment);
    }

    if (loadError) {
      if (shouldRetryAfterLoadError(loadError)) {
        this.loadErrors.delete(key);
        this.ensureCatalogLoaded(environment, key);
        return createFallbackLoadingResult(environment);
      }
      return createFallbackLoadFailedResult(environment, loadError);
    }
    this.ensureCatalogLoaded(environment, key);
    return createFallbackLoadingResult(environment);
  }

  private async loadCatalog(
    environment: JenkinsEnvironmentRef,
    key: string,
    context: CatalogLoadContext
  ): Promise<JenkinsfileStepCatalog> {
    const client = await this.clientProvider.getClient(environment);
    const gdsl = await client.fetchPipelineSyntaxGdsl();
    const liveCatalog = parseJenkinsfileGdsl(gdsl);
    const catalog = mergeStepCatalogs(FALLBACK_JENKINSFILE_STEP_CATALOG, liveCatalog);
    if (this.isCurrentLoadContext(context)) {
      this.loadErrors.delete(key);
      this.cache.set(key, {
        catalog,
        expiresAt: Date.now() + STEP_CATALOG_TTL_MS
      });
    }
    return catalog;
  }

  invalidateAll(): void {
    this.allGeneration += 1;
    this.cache.clear();
    this.inFlight.clear();
    this.loadErrors.clear();
    this.environmentGenerations.clear();
  }

  invalidateEnvironment(environment: JenkinsfileCatalogEnvironmentKey): void {
    const environmentKey = buildEnvironmentKey(environment);
    this.bumpEnvironmentGeneration(environmentKey);
    deleteMatchingKeys(this.cache, environmentKey);
    deleteMatchingKeys(this.inFlight, environmentKey);
    deleteMatchingKeys(this.loadErrors, environmentKey);
  }

  private ensureCatalogLoaded(environment: JenkinsEnvironmentRef, key: string): void {
    const loadError = this.loadErrors.get(key);
    if (this.inFlight.has(key) || (loadError && !shouldRetryAfterLoadError(loadError))) {
      return;
    }
    this.loadErrors.delete(key);
    const load = this.startCatalogLoad(environment, key);
    void load.promise.catch((error) => {
      if (this.isCurrentLoadContext(load.context)) {
        this.loadErrors.set(key, {
          error: normalizeCatalogError(error),
          retryAfter: Date.now() + STEP_CATALOG_RETRY_BACKOFF_MS
        });
      }
    });
  }

  private startCatalogLoad(environment: JenkinsEnvironmentRef, key: string): InFlightLoad {
    const context = this.createLoadContext(environment);
    const loadId = this.nextLoadId;
    this.nextLoadId += 1;
    const promise = this.loadCatalog(environment, key, context).finally(() => {
      if (this.inFlight.get(key)?.id === loadId) {
        this.inFlight.delete(key);
      }
    });
    const load = {
      context,
      id: loadId,
      promise
    };
    this.inFlight.set(key, load);
    return load;
  }

  private createLoadContext(environment: JenkinsfileCatalogEnvironmentKey): CatalogLoadContext {
    const environmentKey = buildEnvironmentKey(environment);
    return {
      allGeneration: this.allGeneration,
      environmentGeneration: this.environmentGenerations.get(environmentKey) ?? 0,
      environmentKey
    };
  }

  private isCurrentLoadContext(context: CatalogLoadContext): boolean {
    return (
      context.allGeneration === this.allGeneration &&
      context.environmentGeneration ===
        (this.environmentGenerations.get(context.environmentKey) ?? 0)
    );
  }

  private bumpEnvironmentGeneration(environmentKey: string): void {
    this.environmentGenerations.set(
      environmentKey,
      (this.environmentGenerations.get(environmentKey) ?? 0) + 1
    );
  }
}

function buildCacheKey(environment: JenkinsEnvironmentRef, authSignature: string): string {
  return [
    buildEnvironmentKey(environment),
    environment.url,
    environment.username ?? "",
    authSignature
  ].join("|");
}

function buildEnvironmentKey(environment: JenkinsfileCatalogEnvironmentKey): string {
  return `${environment.scope}|${environment.environmentId}`;
}

function deleteMatchingKeys<T>(map: Map<string, T>, environmentKey: string): void {
  for (const key of map.keys()) {
    if (key.startsWith(`${environmentKey}|`)) {
      map.delete(key);
    }
  }
}

function createFallbackNoEnvironmentResult(): JenkinsfileStepCatalogResult {
  return {
    catalog: FALLBACK_JENKINSFILE_STEP_CATALOG,
    kind: "fallback-no-environment"
  };
}

function createFallbackLoadingResult(
  environment: JenkinsEnvironmentRef
): JenkinsfileStepCatalogResult {
  return {
    catalog: FALLBACK_JENKINSFILE_STEP_CATALOG,
    kind: "fallback-loading",
    environment
  };
}

function createFallbackLoadFailedResult(
  environment: JenkinsEnvironmentRef,
  error: unknown
): JenkinsfileStepCatalogResult {
  return {
    catalog: FALLBACK_JENKINSFILE_STEP_CATALOG,
    kind: "fallback-load-failed",
    environment,
    error: normalizeCatalogError(error)
  };
}

function createLiveResult(
  catalog: JenkinsfileStepCatalog,
  environment: JenkinsEnvironmentRef
): JenkinsfileStepCatalogResult {
  return {
    catalog,
    environment,
    kind: "live"
  };
}

function normalizeCatalogError(error: unknown): Error {
  if (isLoadErrorEntry(error)) {
    return error.error;
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Failed to load Jenkinsfile step catalog.");
}

function shouldRetryAfterLoadError(loadError: LoadErrorEntry | undefined): boolean {
  return !loadError || loadError.retryAfter <= Date.now();
}

function isLoadErrorEntry(error: unknown): error is LoadErrorEntry {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    "retryAfter" in error &&
    error.error instanceof Error &&
    typeof error.retryAfter === "number"
  );
}
