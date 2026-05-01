import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStoreChange } from "../../storage/JenkinsEnvironmentStore";
import type { TreeActivityOptions } from "../ActivityTypes";
import { ActivityRefreshTracker } from "./ActivityRefreshTracker";

export interface ActivityRefreshServiceOptions {
  activityOptions: TreeActivityOptions;
  refreshActivity: (environment: JenkinsEnvironmentRef) => void;
}

export class ActivityRefreshService {
  private readonly tracker: ActivityRefreshTracker;

  constructor(options: ActivityRefreshServiceOptions) {
    this.tracker = new ActivityRefreshTracker(options);
  }

  updateOptions(activityOptions: TreeActivityOptions): void {
    this.tracker.updateOptions(activityOptions);
  }

  handleActivityFolderExpanded(environment: JenkinsEnvironmentRef): void {
    this.tracker.trackExpanded(environment);
  }

  handleActivityFolderCollapsed(environment: JenkinsEnvironmentRef): void {
    this.tracker.trackCollapsed(environment);
  }

  handleEnvironmentCollapsed(
    environment: Pick<JenkinsEnvironmentRef, "environmentId" | "scope">
  ): void {
    this.tracker.clearEnvironment(environment);
  }

  handleAllEnvironmentsCollapsed(): void {
    this.tracker.clearAll();
  }

  handleEnvironmentStoreChange(change: JenkinsEnvironmentStoreChange): void {
    switch (change.kind) {
      case "bulk-update":
        this.tracker.clearAll();
        return;
      case "environment-removed":
        this.tracker.clearEnvironmentScope(change.scope, change.environmentId);
        return;
      case "environment-added":
      case "auth-config-updated":
      case "auth-config-deleted":
        return;
    }
  }

  handleStatusTick(): void {
    this.tracker.refreshExpanded();
  }
}
