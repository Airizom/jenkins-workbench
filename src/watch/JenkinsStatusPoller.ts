import * as vscode from "vscode";
import { JenkinsRequestError } from "../jenkins/errors";
import type { JenkinsDataService, PendingInputSummary } from "../jenkins/JenkinsDataService";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsStatusRefreshService } from "../services/JenkinsStatusRefreshService";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { EnvironmentScope, JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsWatchStore, WatchedJobEntry } from "../storage/JenkinsWatchStore";
import { JenkinsJobStatusEvaluator } from "./JenkinsJobStatusEvaluator";
import type { StatusNotifier } from "./StatusNotifier";
import { formatWatchJobLabel } from "./WatchJobLabelFormatter";
import { WatchRuntimeStateStore } from "./WatchRuntimeStateStore";

export interface JenkinsStatusPollerHost {
  /** Refreshes one environment, or all of them when `environmentId` is omitted. */
  fullEnvironmentRefresh(environmentId?: string): void;
}

const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

interface JenkinsStatusPollerRuntimeSurface {
  readonly onDidChangeWatchErrorCount: vscode.Event<number>;
  updateMaxConsecutiveErrors(maxConsecutiveErrors: number): void;
  start(options?: StatusPollerStartOptions): void;
}

export interface StatusPollerStartOptions {
  /** Delay before the first poll; later polls follow the shared status tick. */
  initialDelayMs?: number;
}

export class JenkinsStatusPoller implements vscode.Disposable, JenkinsStatusPollerRuntimeSurface {
  private tickSubscription: vscode.Disposable | undefined;
  private initialPollHandle: ReturnType<typeof setTimeout> | undefined;
  private isPolling = false;
  private hasPendingPoll = false;
  private readonly environmentPolls = new Map<string, Promise<void>>();
  private readonly pendingEnvironments = new Set<string>();
  private disposed = false;
  private readonly _onDidChangeWatchErrorCount = new vscode.EventEmitter<number>();
  private readonly evaluator: JenkinsJobStatusEvaluator;
  private readonly watchStates = new WatchRuntimeStateStore();
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
    this.evaluator = new JenkinsJobStatusEvaluator();
  }

  updateMaxConsecutiveErrors(maxConsecutiveErrors: number): void {
    if (this.disposed) {
      return;
    }
    const next = this.normalizeMaxConsecutiveErrors(maxConsecutiveErrors);

    if (next === this.maxConsecutiveErrors) {
      return;
    }

    this.maxConsecutiveErrors = next;
    this.watchStates.resetFailureCounts();
    this.synchronizeWatchErrorCount();
  }

  start(options: StatusPollerStartOptions = {}): void {
    if (this.disposed || this.tickSubscription) {
      return;
    }

    this.tickSubscription = this.statusRefreshService.onDidTick(() => {
      this.clearInitialPoll();
      void this.poll();
    });
    const initialDelayMs = options.initialDelayMs ?? 0;
    if (initialDelayMs <= 0) {
      void this.poll();
      return;
    }
    this.initialPollHandle = setTimeout(() => {
      this.initialPollHandle = undefined;
      void this.poll();
    }, initialDelayMs);
  }

  private clearInitialPoll(): void {
    if (this.initialPollHandle) {
      clearTimeout(this.initialPollHandle);
      this.initialPollHandle = undefined;
    }
  }

  private normalizeMaxConsecutiveErrors(maxConsecutiveErrors: number): number {
    return Number.isFinite(maxConsecutiveErrors)
      ? Math.max(1, Math.floor(maxConsecutiveErrors))
      : DEFAULT_MAX_CONSECUTIVE_ERRORS;
  }

  dispose(): void {
    this.disposed = true;
    this.hasPendingPoll = false;
    this.pendingEnvironments.clear();
    this.clearInitialPoll();
    if (this.tickSubscription) {
      this.tickSubscription.dispose();
      this.tickSubscription = undefined;
    }
    this._onDidChangeWatchErrorCount.dispose();
  }

  private async poll(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.isPolling) {
      this.hasPendingPoll = true;
      return;
    }

    this.isPolling = true;
    const environmentPolls: Promise<void>[] = [];
    try {
      do {
        this.hasPendingPoll = false;
        await this.discoverWatchedJobs(environmentPolls);
        if (this.disposed) return;
      } while (this.hasPendingPoll && !this.disposed);
    } catch (error) {
      if (!this.disposed) {
        console.warn("Failed to poll watched Jenkins jobs.", error);
      }
    } finally {
      this.isPolling = false;
    }
    // Only discovery is shared; Jenkins requests must not hold the scheduling lock.
    await Promise.all(environmentPolls);
  }

  private async discoverWatchedJobs(environmentPolls: Promise<void>[]): Promise<void> {
    const watched = await this.watchStore.listWatchedJobs();
    if (this.disposed) {
      return;
    }
    if (watched.length === 0) {
      if (this.watchStates.clear()) {
        this.synchronizeWatchErrorCount();
      }
    } else if ((await this.checkWatchedJobs(watched, environmentPolls)) && !this.disposed) {
      this.host.fullEnvironmentRefresh();
    }
  }

  private async checkWatchedJobs(
    watched: WatchedJobEntry[],
    environmentPolls: Promise<void>[]
  ): Promise<boolean> {
    const environments = await this.store.listEnvironmentsWithScope();
    if (this.disposed) {
      return false;
    }
    const environmentMap = new Map(
      environments.map((environment) => [
        `${environment.scope}:${environment.id}`,
        toJenkinsEnvironmentRef(environment)
      ])
    );

    const staleByScope = new Map<EnvironmentScope, Set<string>>();
    const watchesByEnvironment = new Map<JenkinsEnvironmentRef, WatchedJobEntry[]>();

    for (const entry of watched) {
      const environment = environmentMap.get(`${entry.scope}:${entry.environmentId}`);
      if (!environment) {
        this.trackStaleEnvironment(staleByScope, entry);
        continue;
      }
      const entries = watchesByEnvironment.get(environment) ?? [];
      entries.push(entry);
      watchesByEnvironment.set(environment, entries);
    }

    // Environments are independent servers, so one slow Jenkins must not delay the others.
    // Jobs within an environment stay sequential to keep per-server load flat.
    for (const [environment, entries] of watchesByEnvironment) {
      const key = `${environment.scope}:${environment.environmentId}`;
      let poll = this.environmentPolls.get(key);
      if (poll) {
        this.pendingEnvironments.add(key);
      } else {
        poll = this.pollEnvironment(environment, entries, key).finally(() => {
          this.environmentPolls.delete(key);
          this.pendingEnvironments.delete(key);
        });
        this.environmentPolls.set(key, poll);
      }
      environmentPolls.push(poll);
    }
    let didChange = false;

    this.watchStates.pruneInactive(watched);
    this.synchronizeWatchErrorCount();

    for (const [scope, environmentIds] of staleByScope) {
      for (const environmentId of environmentIds) {
        if (this.disposed) {
          return false;
        }
        await this.watchStore.removeWatchesForEnvironment(scope, environmentId);
        if (this.disposed) {
          return false;
        }
        this.watchStates.clearEnvironment(scope, environmentId);
        this.synchronizeWatchErrorCount();
        didChange = true;
      }
    }

    return didChange;
  }

  private async pollEnvironment(
    initialEnvironment: JenkinsEnvironmentRef,
    initialEntries: WatchedJobEntry[],
    key: string
  ): Promise<void> {
    let environment = initialEnvironment;
    let entries = initialEntries;
    try {
      while (!this.disposed) {
        this.pendingEnvironments.delete(key);
        let changed = false;
        for (const entry of entries) {
          if (this.disposed) {
            return;
          }
          if (await this.checkWatchedJob(environment, entry)) {
            changed = true;
          }
        }
        if (changed && !this.disposed) {
          this.host.fullEnvironmentRefresh(environment.environmentId);
        }
        if (this.disposed || !this.pendingEnvironments.delete(key)) {
          return;
        }
        // Reload after completion so queued ticks use the status just persisted.
        const watched = await this.watchStore.listWatchedJobs();
        const environments = await this.store.listEnvironmentsWithScope();
        const current = environments.find(
          (candidate) =>
            candidate.scope === environment.scope && candidate.id === environment.environmentId
        );
        if (!current || this.disposed) {
          return;
        }
        environment = toJenkinsEnvironmentRef(current);
        entries = watched.filter(
          (entry) =>
            entry.scope === environment.scope && entry.environmentId === environment.environmentId
        );
      }
    } catch (error) {
      if (!this.disposed) {
        console.warn("Failed to poll watched Jenkins jobs.", error);
      }
    }
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
      if (this.disposed) {
        return false;
      }
      if (this.watchStates.resetFailureCount(entry, this.maxConsecutiveErrors)) {
        this.synchronizeWatchErrorCount();
      }
      const evaluation = this.evaluator.evaluate(
        entry,
        job.name,
        job.color,
        job.lastCompletedBuild,
        environment.url
      );
      await this.checkPendingInputs(environment, entry, job.lastBuild, job.name);
      if (this.disposed) {
        return false;
      }

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
        if (this.disposed) {
          return false;
        }
      }

      const notification = evaluation.notification;
      if (notification?.kind === "failure") {
        this.notifier.notifyFailure(notification.message);
      } else if (notification?.kind === "recovery") {
        this.notifier.notifyRecovery(notification.message);
      } else if (notification?.kind === "completion") {
        this.notifier.notifyCompletion(notification.details);
      }

      return shouldUpdateEntry;
    } catch (error) {
      return await this.handlePollingError(entry, environment, error);
    }
  }

  private async handlePollingError(
    entry: WatchedJobEntry,
    environment: JenkinsEnvironmentRef,
    error: unknown
  ): Promise<boolean> {
    if (this.disposed) {
      return false;
    }
    if (error instanceof JenkinsRequestError && error.statusCode === 404) {
      await this.watchStore.removeWatch(entry.scope, entry.environmentId, entry.jobUrl);
      if (this.disposed) {
        return false;
      }
      this.watchStates.remove(entry);
      this.synchronizeWatchErrorCount();
      this.notifier.notifyWatchError(
        `${formatWatchJobLabel(entry)} was removed because Jenkins reported it missing in ${environment.url}.`
      );
      return true;
    }

    const state = this.watchStates.getOrCreate(entry);
    state.failureCount += 1;

    if (state.failureCount === this.maxConsecutiveErrors) {
      this.notifier.notifyWatchError(
        `Unable to poll ${formatWatchJobLabel(entry)} in ${environment.url} after ${this.maxConsecutiveErrors} attempts. Keeping the watch; check connectivity or credentials.`
      );
    }
    this.synchronizeWatchErrorCount();

    return false;
  }

  private synchronizeWatchErrorCount(): void {
    const nextCount = this.watchStates.countErrors(this.maxConsecutiveErrors);

    if (nextCount === this.watchErrorCount) {
      return;
    }

    this.watchErrorCount = nextCount;
    this._onDidChangeWatchErrorCount.fire(this.watchErrorCount);
  }

  private async checkPendingInputs(
    environment: JenkinsEnvironmentRef,
    entry: WatchedJobEntry,
    lastBuild: { url?: string; building?: boolean } | undefined,
    jobName?: string
  ): Promise<void> {
    const buildUrl = lastBuild?.url;
    if (!buildUrl || !lastBuild.building) {
      this.watchStates.clearPendingInput(entry);
      return;
    }

    const state = this.watchStates.get(entry);
    if (state?.pendingInput && state.pendingInput.buildUrl !== buildUrl) {
      state.pendingInput = undefined;
    }

    try {
      const summary = await this.pendingInputCoordinator.getSummary(environment, buildUrl, {
        maxAgeMs: this.statusRefreshService.getRefreshIntervalMs(),
        notify: false
      });
      if (this.disposed) {
        return;
      }
      this.handlePendingInputSummary(summary, entry, environment.url, buildUrl, jobName);
    } catch (error) {
      if (this.disposed) {
        return;
      }
      console.warn(
        `Failed to check pending inputs for ${formatWatchJobLabel(entry, jobName)} in ${environment.url} (${buildUrl}).`,
        error
      );
    }
  }

  private handlePendingInputSummary(
    summary: PendingInputSummary,
    entry: WatchedJobEntry,
    environmentUrl: string,
    buildUrl: string,
    jobName?: string
  ): void {
    if (!summary.awaitingInput || !summary.signature) {
      this.watchStates.clearPendingInput(entry);
      return;
    }
    const runtimeState = this.watchStates.getOrCreate(entry);
    const previous = runtimeState.pendingInput;
    if (previous?.buildUrl !== buildUrl || previous.signature !== summary.signature) {
      runtimeState.pendingInput = { buildUrl, signature: summary.signature };
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
