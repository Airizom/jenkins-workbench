import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { TreeActivityOptions } from "../ActivityTypes";

const DEFAULT_REFRESH_MIN_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 5_000;

export interface ActivityRefreshTrackerOptions {
  activityOptions: TreeActivityOptions;
  refreshActivity: (environment: JenkinsEnvironmentRef) => void;
}

export class ActivityRefreshTracker {
  private readonly expandedEnvironments = new Map<string, JenkinsEnvironmentRef>();
  private readonly lastRefreshByEnvironment = new Map<string, number>();
  private refreshMinIntervalMs: number;

  constructor(private readonly options: ActivityRefreshTrackerOptions) {
    this.refreshMinIntervalMs = normalizeRefreshMinIntervalMs(
      options.activityOptions.collection.refreshMinIntervalMs
    );
  }

  updateOptions(activityOptions: TreeActivityOptions): void {
    this.refreshMinIntervalMs = normalizeRefreshMinIntervalMs(
      activityOptions.collection.refreshMinIntervalMs
    );
  }

  trackExpanded(environment: JenkinsEnvironmentRef): void {
    this.expandedEnvironments.set(buildEnvironmentKey(environment), environment);
  }

  trackCollapsed(environment: JenkinsEnvironmentRef): void {
    this.clearEnvironment(environment);
  }

  clearEnvironment(environment: Pick<JenkinsEnvironmentRef, "environmentId" | "scope">): void {
    this.clearEnvironmentScope(environment.scope, environment.environmentId);
  }

  clearEnvironmentScope(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const key = buildEnvironmentKeyParts(scope, environmentId);
    this.expandedEnvironments.delete(key);
    this.lastRefreshByEnvironment.delete(key);
  }

  clearAll(): void {
    this.expandedEnvironments.clear();
    this.lastRefreshByEnvironment.clear();
  }

  refreshExpanded(now = Date.now()): void {
    for (const [key, environment] of this.expandedEnvironments) {
      const lastRefreshAt = this.lastRefreshByEnvironment.get(key) ?? 0;
      if (now - lastRefreshAt < this.refreshMinIntervalMs) {
        continue;
      }
      this.lastRefreshByEnvironment.set(key, now);
      this.options.refreshActivity(environment);
    }
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
