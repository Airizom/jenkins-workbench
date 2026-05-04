import type { JenkinsEnvironmentRef } from "../JenkinsEnvironmentRef";
import { JenkinsRequestError } from "../errors";
import { toBuildActionError } from "./JenkinsDataErrors";
import type { JenkinsDataRuntimeContext } from "./JenkinsDataRuntimeContext";
import type { PendingInputAction, PendingInputSummary } from "./JenkinsDataTypes";
import { mapPendingInputActions } from "./JenkinsParameterMapping";

const PENDING_INPUT_ACTIONS_TTL_MS = 5000;
const PENDING_INPUT_SUMMARY_TTL_MS = 60_000;
const PENDING_INPUT_UNSUPPORTED_TTL_MS = 5 * 60 * 1000;

interface PendingInputCacheKeys {
  cacheKey: string;
  summaryKey: string;
  unsupportedKey: string;
}

export class JenkinsPendingInputDataOperations {
  constructor(private readonly context: JenkinsDataRuntimeContext) {}

  async getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]> {
    const keys = await this.buildPendingInputCacheKeys(environment, buildUrl);
    if (this.context.getCache().has(keys.unsupportedKey)) {
      return [];
    }
    const cached = this.context.getCache().get<PendingInputAction[]>(keys.cacheKey);
    if (options?.mode === "cached") {
      return cached ?? [];
    }
    if (cached && options?.mode !== "refresh") {
      return cached;
    }
    return this.fetchPendingInputActions(environment, buildUrl, {
      cacheKey: keys.cacheKey,
      summaryKey: keys.summaryKey,
      unsupportedKey: keys.unsupportedKey
    });
  }

  async getPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh"; maxAgeMs?: number }
  ): Promise<PendingInputSummary> {
    const cacheKey = await this.context.buildCacheKey(
      environment,
      "pending-input-summary",
      buildUrl
    );
    const cached = this.context.getCache().get<PendingInputSummary>(cacheKey);
    if (options?.mode === "cached") {
      return cached ?? this.buildPendingInputSummary([], 0);
    }
    if (cached && options?.mode !== "refresh") {
      const maxAgeMs = options?.maxAgeMs;
      if (!Number.isFinite(maxAgeMs) || typeof maxAgeMs !== "number") {
        return cached;
      }
      const ageMs = Date.now() - cached.fetchedAt;
      if (ageMs <= maxAgeMs) {
        return cached;
      }
    }
    const summary = await this.refreshPendingInputSummary(environment, buildUrl);
    return summary;
  }

  async refreshPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<PendingInputSummary> {
    const actions = await this.getPendingInputActions(environment, buildUrl, {
      mode: "refresh"
    });
    const summary = this.buildPendingInputSummary(actions);
    const cacheKey = await this.context.buildCacheKey(
      environment,
      "pending-input-summary",
      buildUrl
    );
    this.context.getCache().set(cacheKey, summary, PENDING_INPUT_SUMMARY_TTL_MS);
    return summary;
  }

  async approveInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.proceedInput(buildUrl, inputId, options);
    } catch (error) {
      throw toBuildActionError(error);
    } finally {
      await this.clearPendingInputCache(environment, buildUrl);
    }
  }

  async rejectInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    abortUrl?: string
  ): Promise<void> {
    const client = await this.context.getClient(environment);
    try {
      await client.abortInput(buildUrl, inputId, abortUrl);
    } catch (error) {
      throw toBuildActionError(error);
    } finally {
      await this.clearPendingInputCache(environment, buildUrl);
    }
  }

  private async clearPendingInputCache(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<void> {
    const keys = await this.buildPendingInputCacheKeys(environment, buildUrl);
    this.context.getCache().delete(keys.cacheKey);
    this.context.getCache().delete(keys.summaryKey);
    this.context.getCache().delete(keys.unsupportedKey);
  }

  private async fetchPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    keys: PendingInputCacheKeys
  ): Promise<PendingInputAction[]> {
    const client = await this.context.getClient(environment);
    try {
      const actions = await client.getPendingInputActions(buildUrl);
      const mapped = mapPendingInputActions(actions);
      this.context.getCache().set(keys.cacheKey, mapped, PENDING_INPUT_ACTIONS_TTL_MS);
      this.context
        .getCache()
        .set(keys.summaryKey, this.buildPendingInputSummary(mapped), PENDING_INPUT_SUMMARY_TTL_MS);
      return mapped;
    } catch (error) {
      if (error instanceof JenkinsRequestError && error.statusCode === 404) {
        this.context
          .getCache()
          .set(
            keys.unsupportedKey,
            true,
            this.context.getCacheTtlMs() ?? PENDING_INPUT_UNSUPPORTED_TTL_MS
          );
        this.context.getCache().set(keys.cacheKey, [], PENDING_INPUT_ACTIONS_TTL_MS);
        this.context
          .getCache()
          .set(keys.summaryKey, this.buildPendingInputSummary([]), PENDING_INPUT_SUMMARY_TTL_MS);
        return [];
      }
      throw toBuildActionError(error);
    }
  }

  private async buildPendingInputCacheKeys(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<PendingInputCacheKeys> {
    const cacheKey = await this.context.buildCacheKey(environment, "pending-inputs", buildUrl);
    const summaryKey = await this.context.buildCacheKey(
      environment,
      "pending-input-summary",
      buildUrl
    );
    const unsupportedKey = await this.context.buildCacheKey(
      environment,
      "pending-inputs-unsupported",
      buildUrl
    );
    return { cacheKey, summaryKey, unsupportedKey };
  }

  private buildPendingInputSummary(
    actions: PendingInputAction[],
    fetchedAt = Date.now()
  ): PendingInputSummary {
    const signature = this.buildPendingInputSignature(actions);
    const message = actions[0]?.message;
    return {
      awaitingInput: actions.length > 0,
      count: actions.length,
      signature,
      message,
      fetchedAt
    };
  }

  private buildPendingInputSignature(actions: PendingInputAction[]): string | undefined {
    const normalizedActions = actions.map((action) => ({
      id: action.id.trim(),
      message: action.message,
      submitter: action.submitter ?? "",
      proceedText: action.proceedText ?? "",
      parameters: [...action.parameters]
        .map((param) => ({
          name: param.name,
          kind: param.kind,
          description: param.description ?? "",
          defaultValue: param.defaultValue ?? "",
          choices: Array.isArray(param.choices) ? [...param.choices].sort() : []
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
    }));

    normalizedActions.sort(
      (a, b) => a.id.localeCompare(b.id) || a.message.localeCompare(b.message)
    );

    const parts = normalizedActions
      .map((action) => JSON.stringify(action))
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("|") : undefined;
  }
}
