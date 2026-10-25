import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStoreChange } from "../../storage/JenkinsEnvironmentStore";
import type { TreeActivityOptions } from "../ActivityTypes";

const DEFAULT_REFRESH_MIN_INTERVAL_MS = 60_000;
const MIN_REFRESH_INTERVAL_MS = 5_000;

export interface ActivityRefreshServiceOptions {
  activityOptions: TreeActivityOptions;
  refreshActivity: (environment: JenkinsEnvironmentRef) => void;
}

type EnvironmentKeyParts = Pick<JenkinsEnvironmentRef, "environmentId" | "scope">;

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

  /** Swaps in an edited environment (new URL or name) while its Activity folder stays expanded. */
  updateEnvironment(environment: JenkinsEnvironmentRef): void {
    const state = this.refreshStateByEnvironment.get(buildEnvironmentKey(environment));
    if (state) {
      state.environment = environment;
    }
  }

  /** Stops refreshing when the Activity folder or its whole environment collapses. */
  handleEnvironmentCollapsed(environment: EnvironmentKeyParts): void {
    this.refreshStateByEnvironment.delete(buildEnvironmentKey(environment));
  }

  handleEnvironmentStoreChange(change: JenkinsEnvironmentStoreChange): void {
    switch (change.kind) {
      case "bulk-update":
        this.refreshStateByEnvironment.clear();
        return;
      case "environment-removed":
        this.handleEnvironmentCollapsed(change);
        return;
      // The tree item keeps its id across an edit, so the folder stays expanded; the updated
      // ref arrives through updateEnvironment.
      case "environment-updated":
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
}

function buildEnvironmentKey({ scope, environmentId }: EnvironmentKeyParts): string {
  return `${scope}:${environmentId}`;
}

function normalizeRefreshMinIntervalMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_REFRESH_MIN_INTERVAL_MS;
  }
  return Math.max(MIN_REFRESH_INTERVAL_MS, Math.floor(value));
}
