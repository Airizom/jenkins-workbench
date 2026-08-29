import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStoreChange } from "../../storage/JenkinsEnvironmentStore";
import type { TreeActivityOptions } from "../ActivityTypes";

const DEFAULT_REFRESH_MIN_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 5_000;

export interface ActivityRefreshServiceOptions {
  activityOptions: TreeActivityOptions;
  refreshActivity: (environment: JenkinsEnvironmentRef) => void;
}

interface ActivityRefreshState {
  environment: JenkinsEnvironmentRef;
  lastRefreshAt: number;
}

export class ActivityRefreshService {
  private readonly refreshStateByEnvironment = new Map<string, ActivityRefreshState>();
  private refreshMinIntervalMs: number;

  constructor(private readonly options: ActivityRefreshServiceOptions) {
    this.refreshMinIntervalMs = normalizeRefreshMinIntervalMs(
      options.activityOptions.collection.refreshMinIntervalMs
    );
  }

  updateOptions(activityOptions: TreeActivityOptions): void {
    this.refreshMinIntervalMs = normalizeRefreshMinIntervalMs(
      activityOptions.collection.refreshMinIntervalMs
    );
  }

  handleActivityFolderExpanded(environment: JenkinsEnvironmentRef): void {
    const key = buildEnvironmentKey(environment);
    const previous = this.refreshStateByEnvironment.get(key);
    this.refreshStateByEnvironment.set(key, {
      environment,
      lastRefreshAt: previous?.lastRefreshAt ?? 0
    });
  }

  handleActivityFolderCollapsed(environment: JenkinsEnvironmentRef): void {
    this.clearEnvironment(environment.scope, environment.environmentId);
  }

  handleEnvironmentCollapsed(
    environment: Pick<JenkinsEnvironmentRef, "environmentId" | "scope">
  ): void {
    this.clearEnvironment(environment.scope, environment.environmentId);
  }

  handleAllEnvironmentsCollapsed(): void {
    this.clearAll();
  }

  handleEnvironmentStoreChange(change: JenkinsEnvironmentStoreChange): void {
    switch (change.kind) {
      case "bulk-update":
        this.clearAll();
        return;
      case "environment-removed":
        this.clearEnvironment(change.scope, change.environmentId);
        return;
      case "environment-added":
      case "auth-config-updated":
      case "auth-config-deleted":
        return;
    }
  }

  handleStatusTick(): void {
    const now = Date.now();
    for (const state of this.refreshStateByEnvironment.values()) {
      if (now - state.lastRefreshAt < this.refreshMinIntervalMs) {
        continue;
      }
      state.lastRefreshAt = now;
      this.options.refreshActivity(state.environment);
    }
  }

  private clearEnvironment(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const key = buildEnvironmentKeyParts(scope, environmentId);
    this.refreshStateByEnvironment.delete(key);
  }

  private clearAll(): void {
    this.refreshStateByEnvironment.clear();
  }
}

function buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
  return buildEnvironmentKeyParts(environment.scope, environment.environmentId);
}

function buildEnvironmentKeyParts(
  scope: JenkinsEnvironmentRef["scope"],
  environmentId: string
): string {
  return `${scope}:${environmentId}`;
}

function normalizeRefreshMinIntervalMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REFRESH_MIN_INTERVAL_MS;
  }
  return Math.max(MIN_REFRESH_INTERVAL_MS, Math.floor(value));
}
