import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export interface JenkinsQueuePollerHost {
  refreshQueueView(environment: JenkinsEnvironmentRef): void;
}

const DEFAULT_POLL_INTERVAL_SECONDS = 10;
const MIN_POLL_INTERVAL_SECONDS = 2;
const DEFAULT_POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_SECONDS * 1000;

export class JenkinsQueuePoller implements vscode.Disposable {
  private intervalId: NodeJS.Timeout | undefined;
  private isPolling = false;
  private pollIntervalMs: number;
  private readonly expandedEnvironments = new Map<string, JenkinsEnvironmentRef>();

  constructor(
    private readonly host: JenkinsQueuePollerHost,
    pollIntervalSeconds = DEFAULT_POLL_INTERVAL_SECONDS
  ) {
    this.pollIntervalMs = this.normalizePollIntervalSeconds(pollIntervalSeconds);
  }

  trackExpanded(environment: JenkinsEnvironmentRef): void {
    const key = this.buildEnvironmentKey(environment);
    this.expandedEnvironments.set(key, environment);
    this.ensurePolling();
  }

  trackCollapsed(environment: JenkinsEnvironmentRef): void {
    const key = this.buildEnvironmentKey(environment);
    if (!this.expandedEnvironments.delete(key)) {
      return;
    }
    if (this.expandedEnvironments.size === 0) {
      this.stop();
    }
  }

  clearEnvironment(environment: JenkinsEnvironmentRef): void {
    const key = this.buildEnvironmentKey(environment);
    if (!this.expandedEnvironments.delete(key)) {
      return;
    }
    if (this.expandedEnvironments.size === 0) {
      this.stop();
    }
  }

  updateEnvironment(environment: JenkinsEnvironmentRef): void {
    const key = this.buildEnvironmentKey(environment);
    if (!this.expandedEnvironments.has(key)) {
      return;
    }
    this.expandedEnvironments.set(key, environment);
  }

  hasEnvironment(environment: JenkinsEnvironmentRef): boolean {
    const key = this.buildEnvironmentKey(environment);
    return this.expandedEnvironments.has(key);
  }

  clearAll(): void {
    if (this.expandedEnvironments.size === 0) {
      return;
    }
    this.expandedEnvironments.clear();
    this.stop();
  }

  updatePollIntervalSeconds(pollIntervalSeconds: number): void {
    const next = this.normalizePollIntervalSeconds(pollIntervalSeconds);
    if (next === this.pollIntervalMs) {
      return;
    }
    this.pollIntervalMs = next;
    if (this.intervalId) {
      this.stop();
      this.ensurePolling();
    }
  }

  dispose(): void {
    this.stop();
    this.expandedEnvironments.clear();
  }

  private ensurePolling(): void {
    if (this.intervalId || this.expandedEnvironments.size === 0) {
      return;
    }
    const interval = this.pollIntervalMs;
    this.intervalId = setInterval(() => {
      void this.poll();
    }, interval);
    void this.poll();
  }

  private stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private poll(): void {
    if (this.isPolling || this.expandedEnvironments.size === 0) {
      return;
    }
    this.isPolling = true;
    try {
      for (const environment of this.expandedEnvironments.values()) {
        this.host.refreshQueueView(environment);
      }
    } finally {
      this.isPolling = false;
    }
  }

  private buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.scope}:${environment.environmentId}`;
  }

  private normalizePollIntervalSeconds(pollIntervalSeconds: number): number {
    if (!Number.isFinite(pollIntervalSeconds)) {
      return DEFAULT_POLL_INTERVAL_MS;
    }
    const clamped = Math.max(MIN_POLL_INTERVAL_SECONDS, pollIntervalSeconds);
    return clamped * 1000;
  }
}
