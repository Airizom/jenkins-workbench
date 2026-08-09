import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStoreChange } from "../../storage/JenkinsEnvironmentStore";
import type { TreeActivityOptions } from "../ActivityTypes";

const DEFAULT_REFRESH_MIN_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 5_000;

export interface ActivityRefreshServiceOptions {
  activityOptions: TreeActivityOptions;
  refreshActivity: (environment: JenkinsEnvironmentRef) => void;
}

export class ActivityRefreshService {
  private readonly expandedEnvironments = new Map<string, JenkinsEnvironmentRef>();
  private readonly lastRefreshByEnvironment = new Map<string, number>();
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
    this.expandedEnvironments.set(buildEnvironmentKey(environment), environment);
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
    for (const [key, environment] of this.expandedEnvironments) {
      const lastRefreshAt = this.lastRefreshByEnvironment.get(key) ?? 0;
      if (now - lastRefreshAt < this.refreshMinIntervalMs) {
        continue;
      }
      this.lastRefreshByEnvironment.set(key, now);
      this.options.refreshActivity(environment);
    }
  }

  private clearEnvironment(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const key = buildEnvironmentKeyParts(scope, environmentId);
    this.expandedEnvironments.delete(key);
    this.lastRefreshByEnvironment.delete(key);
  }

  private clearAll(): void {
    this.expandedEnvironments.clear();
    this.lastRefreshByEnvironment.clear();
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
