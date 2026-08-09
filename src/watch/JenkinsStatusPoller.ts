import * as vscode from "vscode";
import { JenkinsRequestError } from "../jenkins/errors";
import type { JenkinsDataService, PendingInputSummary } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsStatusRefreshService } from "../services/JenkinsStatusRefreshService";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { EnvironmentScope, JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsWatchStore, WatchedJobEntry } from "../storage/JenkinsWatchStore";
import { JenkinsJobStatusEvaluator } from "./JenkinsJobStatusEvaluator";
import type { StatusNotifier } from "./StatusNotifier";
import { formatWatchJobLabel } from "./WatchJobLabelFormatter";

export interface JenkinsStatusPollerHost {
  fullEnvironmentRefresh(): void;
}

const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

interface JenkinsStatusPollerRuntimeSurface {
  readonly onDidChangeWatchErrorCount: vscode.Event<number>;
  updateMaxConsecutiveErrors(maxConsecutiveErrors: number): void;
  start(): void;
}

interface WatchRuntimeState {
  failureCount: number;
  hasError: boolean;
  readonly pendingInputSignatures: Map<string, string>;
}

export class JenkinsStatusPoller implements vscode.Disposable, JenkinsStatusPollerRuntimeSurface {
  private tickSubscription: vscode.Disposable | undefined;
  private isPolling = false;
  private hasPendingPoll = false;
  private readonly _onDidChangeWatchErrorCount = new vscode.EventEmitter<number>();
  private readonly evaluator: JenkinsJobStatusEvaluator;
  private readonly watchStates = new Map<string, WatchRuntimeState>();
  private maxConsecutiveErrors: number;
  private watchErrorCount = 0;

  readonly onDidChangeWatchErrorCount = this._onDidChangeWatchErrorCount.event;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly statusRefreshService: JenkinsStatusRefreshService,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly watchStore: JenkinsWatchStore,
    private readonly notifier: StatusNotifier,
    private readonly host: JenkinsStatusPollerHost,
    maxConsecutiveErrors = DEFAULT_MAX_CONSECUTIVE_ERRORS
  ) {
    this.maxConsecutiveErrors = this.normalizeMaxConsecutiveErrors(maxConsecutiveErrors);
    this.evaluator = new JenkinsJobStatusEvaluator(this.notifier);
  }

  updateMaxConsecutiveErrors(maxConsecutiveErrors: number): void {
    const next = this.normalizeMaxConsecutiveErrors(maxConsecutiveErrors);

    if (next === this.maxConsecutiveErrors) {
      return;
    }

    this.maxConsecutiveErrors = next;
    for (const state of this.watchStates.values()) {
      state.failureCount = 0;
      state.hasError = false;
    }
    this.updateWatchErrorCount(-this.watchErrorCount);
  }

  start(): void {
    if (this.tickSubscription) {
      return;
    }

    this.tickSubscription = this.statusRefreshService.onDidTick(() => {
      void this.poll();
    });
    void this.poll();
  }

  private normalizeMaxConsecutiveErrors(maxConsecutiveErrors: number): number {
    return Number.isFinite(maxConsecutiveErrors)
      ? Math.max(1, Math.floor(maxConsecutiveErrors))
      : DEFAULT_MAX_CONSECUTIVE_ERRORS;
  }

  dispose(): void {
    if (this.tickSubscription) {
      this.tickSubscription.dispose();
      this.tickSubscription = undefined;
    }
    this._onDidChangeWatchErrorCount.dispose();
  }

  private async poll(): Promise<void> {
    if (this.isPolling) {
      this.hasPendingPoll = true;
      return;
    }

    this.isPolling = true;
    try {
      do {
        this.hasPendingPoll = false;
        const watched = await this.watchStore.listWatchedJobs();
        if (watched.length === 0) {
          this.clearWatchState();
        } else if (await this.checkWatchedJobs(watched)) {
          this.host.fullEnvironmentRefresh();
        }
      } while (this.hasPendingPoll);
    } finally {
      this.isPolling = false;
    }
  }

  private async checkWatchedJobs(watched: WatchedJobEntry[]): Promise<boolean> {
    const environments = await this.store.listEnvironmentsWithScope();
    const environmentMap = new Map(
      environments.map((environment) => {
        const ref: JenkinsEnvironmentRef = {
          environmentId: environment.id,
          scope: environment.scope,
          url: environment.url,
          username: environment.username
        };
        return [`${environment.scope}:${environment.id}`, ref];
      })
    );

    const staleByScope = new Map<EnvironmentScope, Set<string>>();
    let didChange = false;
    const activeWatchKeys = new Set<string>();

    for (const entry of watched) {
      activeWatchKeys.add(this.buildWatchKey(entry));
      const environment = environmentMap.get(`${entry.scope}:${entry.environmentId}`);
      if (!environment) {
        this.trackStaleEnvironment(staleByScope, entry);
        continue;
      }

      const changed = await this.checkWatchedJob(environment, entry);
      if (changed) {
        didChange = true;
      }
    }

    this.pruneInactiveWatchStates(activeWatchKeys);

    for (const [scope, environmentIds] of staleByScope) {
      for (const environmentId of environmentIds) {
        await this.watchStore.removeWatchesForEnvironment(scope, environmentId);
        this.clearWatchStatesForEnvironment(scope, environmentId);
        didChange = true;
      }
    }

    return didChange;
  }

  private trackStaleEnvironment(
    staleByScope: Map<EnvironmentScope, Set<string>>,
    entry: WatchedJobEntry
  ): void {
    const scoped = staleByScope.get(entry.scope) ?? new Set<string>();
    scoped.add(entry.environmentId);
    staleByScope.set(entry.scope, scoped);
  }

  private async checkWatchedJob(
    environment: JenkinsEnvironmentRef,
    entry: WatchedJobEntry
  ): Promise<boolean> {
    try {
      const job = await this.dataService.getJob(environment, entry.jobUrl);
      this.resetFailureCount(entry);
      const evaluation = this.evaluator.evaluate(
        entry,
        job.name,
        job.color,
        job.lastCompletedBuild,
        environment.url
      );
      await this.checkPendingInputs(
        environment,
        entry,
        job.lastBuild?.url,
        job.lastBuild,
        job.name
      );

      const jobNameChanged = job.name !== entry.jobName;
      const shouldUpdateEntry =
        evaluation.shouldUpdateStatus ||
        evaluation.shouldUpdateCompletion ||
        evaluation.shouldUpdateBuilding ||
        jobNameChanged;

      if (shouldUpdateEntry) {
        await this.watchStore.updateWatchStatus(entry.scope, entry.environmentId, entry.jobUrl, {
          lastStatus: evaluation.shouldUpdateStatus ? evaluation.nextStatus : undefined,
          lastCompletedBuildNumber: evaluation.shouldUpdateCompletion
            ? evaluation.currentCompletedBuildNumber
            : undefined,
          lastIsBuilding: evaluation.shouldUpdateBuilding
            ? evaluation.currentIsBuilding
            : undefined,
          jobName: job.name
        });
      }

      return evaluation.shouldRefresh || jobNameChanged;
    } catch (error) {
      return await this.handlePollingError(entry, environment, error);
    }
  }

  private async handlePollingError(
    entry: WatchedJobEntry,
    environment: JenkinsEnvironmentRef,
    error: unknown
  ): Promise<boolean> {
    if (error instanceof JenkinsRequestError && error.statusCode === 404) {
      await this.watchStore.removeWatch(entry.scope, entry.environmentId, entry.jobUrl);
      this.removeWatchState(entry);
      this.notifier.notifyWatchError(
        `${formatWatchJobLabel(entry)} was removed because Jenkins reported it missing in ${environment.url}.`
      );
      return true;
    }

    const state = this.getOrCreateWatchState(entry);
    state.failureCount += 1;

    if (state.failureCount < this.maxConsecutiveErrors) {
      return false;
    }

    if (state.failureCount === this.maxConsecutiveErrors) {
      this.notifier.notifyWatchError(
        `Unable to poll ${formatWatchJobLabel(entry)} in ${environment.url} after ${this.maxConsecutiveErrors} attempts. Keeping the watch; check connectivity or credentials.`
      );
      state.hasError = true;
      this.updateWatchErrorCount(1);
    }

    return false;
  }

  private buildWatchKey(entry: WatchedJobEntry): string {
    return `${entry.scope}:${entry.environmentId}:${entry.jobUrl}`;
  }

  private getOrCreateWatchState(entry: WatchedJobEntry): WatchRuntimeState {
    const key = this.buildWatchKey(entry);
    const existing = this.watchStates.get(key);
    if (existing) {
      return existing;
    }
    const state: WatchRuntimeState = {
      failureCount: 0,
      hasError: false,
      pendingInputSignatures: new Map<string, string>()
    };
    this.watchStates.set(key, state);
    return state;
  }

  private resetFailureCount(entry: WatchedJobEntry): void {
    const state = this.watchStates.get(this.buildWatchKey(entry));
    if (!state) {
      return;
    }
    const hadError = state.hasError;
    state.failureCount = 0;
    state.hasError = false;
    if (hadError) {
      this.updateWatchErrorCount(-1);
    }
  }

  private clearPendingInputsForJob(entry: WatchedJobEntry): void {
    this.watchStates.get(this.buildWatchKey(entry))?.pendingInputSignatures.clear();
  }

  private pruneInactiveWatchStates(activeKeys: Set<string>): void {
    let removedErrorCount = 0;
    for (const [key, state] of this.watchStates) {
      if (!activeKeys.has(key)) {
        this.watchStates.delete(key);
        removedErrorCount += state.hasError ? 1 : 0;
      }
    }
    this.updateWatchErrorCount(-removedErrorCount);
  }

  private clearWatchStatesForEnvironment(scope: EnvironmentScope, environmentId: string): void {
    const prefix = `${scope}:${environmentId}:`;
    let removedErrorCount = 0;
    for (const [key, state] of this.watchStates) {
      if (key.startsWith(prefix)) {
        this.watchStates.delete(key);
        removedErrorCount += state.hasError ? 1 : 0;
      }
    }
    this.updateWatchErrorCount(-removedErrorCount);
  }

  private removeWatchState(entry: WatchedJobEntry): void {
    const key = this.buildWatchKey(entry);
    const state = this.watchStates.get(key);
    this.watchStates.delete(key);
    if (state?.hasError) {
      this.updateWatchErrorCount(-1);
    }
  }

  private clearWatchState(): void {
    if (this.watchStates.size === 0) {
      return;
    }
    this.watchStates.clear();
    this.updateWatchErrorCount(-this.watchErrorCount);
  }

  private updateWatchErrorCount(delta: number): void {
    if (delta === 0) {
      return;
    }
    this.watchErrorCount += delta;
    this._onDidChangeWatchErrorCount.fire(this.watchErrorCount);
  }

  private async checkPendingInputs(
    environment: JenkinsEnvironmentRef,
    entry: WatchedJobEntry,
    buildUrl: string | undefined,
    buildSummary?: { building?: boolean },
    jobName?: string
  ): Promise<void> {
    if (!buildUrl || !buildSummary?.building) {
      this.clearPendingInputsForJob(entry);
      return;
    }

    try {
      const summary = await this.pendingInputCoordinator.getSummary(environment, buildUrl, {
        maxAgeMs: this.statusRefreshService.getRefreshIntervalMs(),
        notify: false
      });
      this.handlePendingInputSummary(summary, entry, environment.url, buildUrl, jobName);
    } catch (error) {
      console.warn(
        `Failed to check pending inputs for ${formatWatchJobLabel(entry, jobName)} in ${environment.url} (${buildUrl}).`,
        error
      );
      return;
    }
  }

  private handlePendingInputSummary(
    summary: PendingInputSummary,
    entry: WatchedJobEntry,
    environmentUrl: string,
    buildUrl: string,
    jobName?: string
  ): void {
    const state = this.watchStates.get(this.buildWatchKey(entry));
    if (!summary.awaitingInput || !summary.signature) {
      state?.pendingInputSignatures.delete(buildUrl);
      return;
    }
    const runtimeState = state ?? this.getOrCreateWatchState(entry);
    const previousSignature = runtimeState.pendingInputSignatures.get(buildUrl);
    if (previousSignature !== summary.signature) {
      runtimeState.pendingInputSignatures.set(buildUrl, summary.signature);
      this.notifier.notifyPendingInput({
        jobLabel: formatWatchJobLabel(entry, jobName),
        environmentUrl,
        buildUrl,
        inputCount: summary.count,
        inputMessage: summary.message
      });
    }
  }
}
