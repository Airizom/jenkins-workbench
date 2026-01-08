import type * as vscode from "vscode";
import type { JenkinsDataService, PendingInputSummary } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { JenkinsRequestError } from "../jenkins/errors";
import type { PendingInputRefreshCoordinator } from "../services/PendingInputRefreshCoordinator";
import type { EnvironmentScope, JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsWatchStore, WatchedJobEntry } from "../storage/JenkinsWatchStore";
import { JenkinsJobStatusEvaluator } from "./JenkinsJobStatusEvaluator";
import type { StatusNotifier } from "./StatusNotifier";

export interface JenkinsStatusPollerHost {
  refreshTree(): void;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const MIN_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_SECONDS * 1000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

export class JenkinsStatusPoller implements vscode.Disposable {
  private intervalId: NodeJS.Timeout | undefined;
  private isPolling = false;
  private readonly evaluator: JenkinsJobStatusEvaluator;
  private readonly failureCounts = new Map<string, number>();
  private readonly pendingInputSignatures = new Map<string, string>();
  private pollIntervalMs: number;
  private maxConsecutiveErrors: number;

  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly watchStore: JenkinsWatchStore,
    private readonly notifier: StatusNotifier,
    private readonly host: JenkinsStatusPollerHost,
    pollIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS,
    maxConsecutiveErrors = DEFAULT_MAX_CONSECUTIVE_ERRORS
  ) {
    this.pollIntervalMs = this.normalizePollIntervalSeconds(pollIntervalSeconds);
    this.maxConsecutiveErrors = this.normalizeMaxConsecutiveErrors(maxConsecutiveErrors);
    this.evaluator = new JenkinsJobStatusEvaluator(this.notifier);
  }

  updatePollIntervalSeconds(pollIntervalSeconds: number): void {
    const next = this.normalizePollIntervalSeconds(pollIntervalSeconds);

    if (next === this.pollIntervalMs) {
      return;
    }

    this.pollIntervalMs = next;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.start();
    }
  }

  updateMaxConsecutiveErrors(maxConsecutiveErrors: number): void {
    const next = this.normalizeMaxConsecutiveErrors(maxConsecutiveErrors);

    if (next === this.maxConsecutiveErrors) {
      return;
    }

    this.maxConsecutiveErrors = next;
    this.failureCounts.clear();
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    const interval = this.pollIntervalMs;
    this.intervalId = setInterval(() => {
      void this.poll();
    }, interval);

    void this.poll();
  }

  private normalizePollIntervalSeconds(pollIntervalSeconds: number): number {
    if (!Number.isFinite(pollIntervalSeconds)) {
      return DEFAULT_POLL_INTERVAL_MS;
    }

    const clampedSeconds = Math.max(MIN_POLL_INTERVAL_SECONDS, pollIntervalSeconds);
    return clampedSeconds * 1000;
  }

  private normalizeMaxConsecutiveErrors(maxConsecutiveErrors: number): number {
    return Number.isFinite(maxConsecutiveErrors)
      ? Math.max(1, Math.floor(maxConsecutiveErrors))
      : DEFAULT_MAX_CONSECUTIVE_ERRORS;
  }

  dispose(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private async poll(): Promise<void> {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      const watched = await this.watchStore.listWatchedJobs();
      if (watched.length === 0) {
        return;
      }
      const didChange = await this.checkWatchedJobs(watched);
      if (didChange) {
        this.host.refreshTree();
      }
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

    for (const entry of watched) {
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

    for (const [scope, environmentIds] of staleByScope) {
      for (const environmentId of environmentIds) {
        await this.watchStore.removeWatchesForEnvironment(scope, environmentId);
        this.clearFailuresForEnvironment(scope, environmentId);
        this.clearPendingInputsForEnvironment(scope, environmentId);
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

      const shouldUpdateEntry =
        evaluation.shouldUpdateStatus ||
        evaluation.shouldUpdateCompletion ||
        evaluation.shouldUpdateBuilding ||
        job.name !== entry.jobName;

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

      return evaluation.shouldRefresh;
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
      this.failureCounts.delete(this.buildFailureKey(entry));
      this.clearPendingInputsForJob(entry);
      this.notifier.notifyWatchError(
        `${this.formatWatchLabel(entry)} was removed because Jenkins reported it missing in ${environment.url}.`
      );
      return true;
    }

    const key = this.buildFailureKey(entry);
    const nextCount = (this.failureCounts.get(key) ?? 0) + 1;
    this.failureCounts.set(key, nextCount);

    if (nextCount < this.maxConsecutiveErrors) {
      return false;
    }

    if (nextCount === this.maxConsecutiveErrors) {
      this.notifier.notifyWatchError(
        `Unable to poll ${this.formatWatchLabel(entry)} in ${environment.url} after ${this.maxConsecutiveErrors} attempts. Keeping the watch; check connectivity or credentials.`
      );
    }

    return false;
  }

  private buildFailureKey(entry: WatchedJobEntry): string {
    return `${entry.scope}:${entry.environmentId}:${entry.jobUrl}`;
  }

  private resetFailureCount(entry: WatchedJobEntry): void {
    this.failureCounts.delete(this.buildFailureKey(entry));
  }

  private clearFailuresForEnvironment(scope: EnvironmentScope, environmentId: string): void {
    for (const key of this.failureCounts.keys()) {
      if (key.startsWith(`${scope}:${environmentId}:`)) {
        this.failureCounts.delete(key);
      }
    }
  }

  private clearPendingInputsForEnvironment(scope: EnvironmentScope, environmentId: string): void {
    const prefix = `${scope}:${environmentId}:`;
    for (const key of this.pendingInputSignatures.keys()) {
      if (key.startsWith(prefix)) {
        this.pendingInputSignatures.delete(key);
      }
    }
  }

  private formatWatchLabel(entry: WatchedJobEntry, jobName?: string): string {
    const label = jobName ?? entry.jobName ?? entry.jobUrl;
    const kind = entry.jobKind === "pipeline" ? "Pipeline" : "Job";
    return `${kind} ${label}`;
  }

  private clearPendingInputsForJob(entry: WatchedJobEntry): void {
    const prefix = `${entry.scope}:${entry.environmentId}:${entry.jobUrl}:`;
    for (const key of this.pendingInputSignatures.keys()) {
      if (key.startsWith(prefix)) {
        this.pendingInputSignatures.delete(key);
      }
    }
  }

  private buildPendingInputKey(entry: WatchedJobEntry, buildUrl: string): string {
    return `${entry.scope}:${entry.environmentId}:${entry.jobUrl}:${buildUrl}`;
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
      const pendingKey = this.buildPendingInputKey(entry, buildUrl);
      const summary = await this.pendingInputCoordinator.getSummary(environment, buildUrl, {
        maxAgeMs: this.pollIntervalMs,
        notify: false
      });
      this.handlePendingInputSummary(summary, pendingKey, entry, environment.url, buildUrl, jobName);
    } catch {
      return;
    }
  }

  private handlePendingInputSummary(
    summary: PendingInputSummary,
    pendingKey: string,
    entry: WatchedJobEntry,
    environmentUrl: string,
    buildUrl: string,
    jobName?: string
  ): void {
    if (!summary.awaitingInput || !summary.signature) {
      this.pendingInputSignatures.delete(pendingKey);
      return;
    }
    const previousSignature = this.pendingInputSignatures.get(pendingKey);
    if (previousSignature !== summary.signature) {
      this.pendingInputSignatures.set(pendingKey, summary.signature);
      this.notifier.notifyPendingInput({
        jobLabel: this.formatWatchLabel(entry, jobName),
        environmentUrl,
        buildUrl,
        inputCount: summary.count,
        inputMessage: summary.message
      });
    }
  }
}
