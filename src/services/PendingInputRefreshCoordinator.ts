import type * as vscode from "vscode";
import type {
  JenkinsDataService,
  PendingInputAction,
  PendingInputSummary
} from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export interface PendingInputSummaryChange {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  previous?: PendingInputSummary;
  summary: PendingInputSummary;
}

export type PendingInputSummaryListener = (change: PendingInputSummaryChange) => void;

const DEFAULT_STALE_AFTER_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_REFRESH_THROTTLE_MS = 1000;
const QUEUE_COMPACT_THRESHOLD = 1024;

interface RefreshWorkItem {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  previous?: PendingInputSummary;
}

interface PendingInputActionsRuntimeSurface {
  getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]>;
}

export class PendingInputRefreshCoordinator
  implements vscode.Disposable, PendingInputActionsRuntimeSurface
{
  private readonly queue: RefreshWorkItem[] = [];
  private readonly queuedKeys = new Set<string>();
  private readonly inFlightPromises = new Map<string, Promise<PendingInputSummary>>();
  private readonly actionPromises = new Map<string, Promise<PendingInputAction[]>>();
  private readonly listeners = new Set<PendingInputSummaryListener>();
  private readonly refreshAt = new Map<string, number>();
  private readonly pendingChanges = new Map<string, Map<string, PendingInputSummaryChange>>();
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private queueHead = 0;
  private inFlight = 0;
  private processing = false;
  private disposed = false;
  private staleAfterMs: number;
  private concurrency: number;
  private refreshThrottleMs: number;

  constructor(
    private readonly dataService: JenkinsDataService,
    options?: { staleAfterMs?: number; concurrency?: number; refreshThrottleMs?: number }
  ) {
    this.staleAfterMs = Math.max(0, options?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
    this.concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY);
    this.refreshThrottleMs = Math.max(0, options?.refreshThrottleMs ?? DEFAULT_REFRESH_THROTTLE_MS);
  }

  onSummaryChange(listener: PendingInputSummaryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.pendingChanges.clear();
    this.listeners.clear();
    this.queue.length = 0;
    this.queueHead = 0;
    this.queuedKeys.clear();
    this.inFlightPromises.clear();
    this.actionPromises.clear();
    this.refreshAt.clear();
  }

  queueRefresh(
    environment: JenkinsEnvironmentRef,
    buildUrls: string[],
    previousSummaries: Map<string, PendingInputSummary>
  ): void {
    if (this.disposed) {
      return;
    }
    const now = Date.now();
    for (const buildUrl of buildUrls) {
      const previous = previousSummaries.get(buildUrl);
      const fetchedAt = previous?.fetchedAt ?? 0;
      if (fetchedAt > 0 && now - fetchedAt < this.staleAfterMs) {
        continue;
      }
      const key = this.buildKey(environment, buildUrl);
      if (this.queuedKeys.has(key) || this.inFlightPromises.has(key)) {
        continue;
      }
      this.queue.push({ environment, buildUrl, previous });
      this.queuedKeys.add(key);
    }

    void this.processQueue();
  }

  async getSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { maxAgeMs?: number; notify?: boolean }
  ): Promise<PendingInputSummary> {
    if (this.disposed) {
      return createEmptySummary();
    }
    if (options?.notify === false) {
      return this.dataService.getPendingInputSummary(environment, buildUrl, {
        maxAgeMs: options?.maxAgeMs
      });
    }

    const cached = await this.dataService.getPendingInputSummary(environment, buildUrl, {
      mode: "cached"
    });
    const maxAgeMs = options?.maxAgeMs;
    if (
      cached.fetchedAt > 0 &&
      Number.isFinite(maxAgeMs) &&
      typeof maxAgeMs === "number" &&
      Date.now() - cached.fetchedAt <= maxAgeMs
    ) {
      return cached;
    }
    return this.refreshSummary(environment, buildUrl, cached);
  }

  async getSummaries(
    environment: JenkinsEnvironmentRef,
    buildUrls: string[],
    options?: { queueRefresh?: boolean }
  ): Promise<Map<string, PendingInputSummary>> {
    if (this.disposed) {
      const empty = new Map<string, PendingInputSummary>();
      for (const buildUrl of buildUrls) {
        empty.set(buildUrl, createEmptySummary());
      }
      return empty;
    }
    const summariesByUrl = new Map<string, PendingInputSummary>();
    await Promise.all(
      buildUrls.map(async (buildUrl) => {
        try {
          const summary = await this.dataService.getPendingInputSummary(environment, buildUrl, {
            mode: "cached"
          });
          summariesByUrl.set(buildUrl, summary);
        } catch {
          summariesByUrl.set(buildUrl, createEmptySummary());
        }
      })
    );

    if (options?.queueRefresh) {
      this.queueRefresh(environment, buildUrls, summariesByUrl);
    }

    return summariesByUrl;
  }

  async getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]> {
    if (this.disposed) {
      return [];
    }
    if (options?.mode === "cached") {
      return this.dataService.getPendingInputActions(environment, buildUrl, options);
    }
    const key = `${this.buildKey(environment, buildUrl)}:${options?.mode ?? "default"}`;
    const inFlight = this.actionPromises.get(key);
    if (inFlight) {
      return inFlight;
    }
    const promise = this.dataService
      .getPendingInputActions(environment, buildUrl, options)
      .finally(() => {
        this.actionPromises.delete(key);
      });
    this.actionPromises.set(key, promise);
    return promise;
  }

  async refreshSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    previous?: PendingInputSummary
  ): Promise<PendingInputSummary> {
    if (this.disposed) {
      return createEmptySummary();
    }
    const key = this.buildKey(environment, buildUrl);
    const inFlight = this.inFlightPromises.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.dataService
      .refreshPendingInputSummary(environment, buildUrl)
      .then((summary) => {
        if (this.didSummaryChange(previous, summary)) {
          this.notifyChange({ environment, buildUrl, previous, summary });
        }
        return summary;
      })
      .finally(() => {
        this.inFlightPromises.delete(key);
      });

    this.inFlightPromises.set(key, promise);
    return promise;
  }

  private async processQueue(): Promise<void> {
    if (this.disposed || this.processing) {
      return;
    }
    this.processing = true;
    try {
      while (this.inFlight < this.concurrency && this.queueHead < this.queue.length) {
        const item = this.queue[this.queueHead];
        this.queueHead += 1;
        if (!item) {
          break;
        }
        const key = this.buildKey(item.environment, item.buildUrl);
        this.queuedKeys.delete(key);
        if (this.inFlightPromises.has(key)) {
          continue;
        }
        this.inFlight += 1;
        void this.refreshSummary(item.environment, item.buildUrl, item.previous)
          .catch(() => {
            // Background refresh failures are non-fatal; foreground callers
            // that need the summary surface errors themselves.
          })
          .finally(() => {
            this.inFlight -= 1;
            void this.processQueue();
          });
      }
    } finally {
      this.processing = false;
      if (this.queueHead === this.queue.length) {
        this.queue.length = 0;
        this.queueHead = 0;
      } else if (
        this.queueHead >= QUEUE_COMPACT_THRESHOLD &&
        this.queueHead * 2 >= this.queue.length
      ) {
        this.queue.splice(0, this.queueHead);
        this.queueHead = 0;
      }
      if (this.queueHead < this.queue.length && this.inFlight < this.concurrency) {
        void this.processQueue();
      }
    }
  }

  private didSummaryChange(
    previous: PendingInputSummary | undefined,
    next: PendingInputSummary
  ): boolean {
    if (!previous) {
      return next.awaitingInput;
    }
    return (
      previous.awaitingInput !== next.awaitingInput ||
      previous.count !== next.count ||
      previous.signature !== next.signature
    );
  }

  private notifyChange(change: PendingInputSummaryChange): void {
    const environmentKey = `${change.environment.scope}:${change.environment.environmentId}`;
    const now = Date.now();
    const last = this.refreshAt.get(environmentKey) ?? 0;
    const elapsed = now - last;
    if (elapsed < this.refreshThrottleMs) {
      const pendingForEnv = this.getOrCreatePendingChanges(environmentKey);
      pendingForEnv.set(change.buildUrl, change);
      if (!this.pendingTimers.has(environmentKey)) {
        const delay = Math.max(0, this.refreshThrottleMs - elapsed);
        const timer = setTimeout(() => {
          this.flushPendingChanges(environmentKey);
        }, delay);
        this.pendingTimers.set(environmentKey, timer);
      }
      return;
    }
    this.refreshAt.set(environmentKey, now);
    this.emitChange(change);
  }

  private getOrCreatePendingChanges(
    environmentKey: string
  ): Map<string, PendingInputSummaryChange> {
    const existing = this.pendingChanges.get(environmentKey);
    if (existing) {
      return existing;
    }

    const pending = new Map<string, PendingInputSummaryChange>();
    this.pendingChanges.set(environmentKey, pending);
    return pending;
  }

  private flushPendingChanges(environmentKey: string): void {
    this.pendingTimers.delete(environmentKey);
    const pending = this.pendingChanges.get(environmentKey);
    this.pendingChanges.delete(environmentKey);
    if (!pending || pending.size === 0) {
      return;
    }

    this.refreshAt.set(environmentKey, Date.now());
    for (const change of pending.values()) {
      this.emitChange(change);
    }
  }

  private emitChange(change: PendingInputSummaryChange): void {
    for (const listener of this.listeners) {
      listener(change);
    }
  }

  private buildKey(environment: JenkinsEnvironmentRef, buildUrl: string): string {
    return `${environment.scope}:${environment.environmentId}:${buildUrl}`;
  }
}

function createEmptySummary(): PendingInputSummary {
  return { awaitingInput: false, count: 0, fetchedAt: 0 };
}
