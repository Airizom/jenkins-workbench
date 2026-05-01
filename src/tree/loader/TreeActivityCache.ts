import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  ACTIVITY_GROUP_ORDER,
  type ActivityDisplaySummary,
  type ActivityGroupKind
} from "../ActivityTypes";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";

type BuildChildrenKey = (
  kind: string,
  environment: JenkinsEnvironmentRef,
  extra?: string
) => string;

export class TreeActivityCache {
  private readonly summaries = new Map<string, ActivityDisplaySummary>();
  private readonly childKeys = new Set<string>();

  constructor(
    private readonly cacheManager: TreeChildrenCacheManager,
    private readonly buildChildrenKey: BuildChildrenKey
  ) {}

  getSummary(environment: JenkinsEnvironmentRef): ActivityDisplaySummary | undefined {
    return this.summaries.get(this.buildEnvironmentKey(environment));
  }

  setSummary(environment: JenkinsEnvironmentRef, summary: ActivityDisplaySummary): void {
    this.summaries.set(this.buildEnvironmentKey(environment), summary);
  }

  getGroupChildren(
    environment: JenkinsEnvironmentRef,
    group: ActivityGroupKind
  ): WorkbenchTreeElement[] | undefined {
    return this.cacheManager.getCachedChildren<WorkbenchTreeElement[]>(
      this.buildActivityGroupChildrenKey(environment, group)
    );
  }

  setGroupChildren(
    environment: JenkinsEnvironmentRef,
    group: ActivityGroupKind,
    children: WorkbenchTreeElement[]
  ): void {
    this.cacheManager.setChildren(this.buildActivityGroupChildrenKey(environment, group), children);
  }

  buildActivityRootChildrenKey(environment: JenkinsEnvironmentRef): string {
    return this.trackChildKey(this.buildChildrenKey("activity-root", environment));
  }

  buildActivityGroupChildrenKey(
    environment: JenkinsEnvironmentRef,
    group: ActivityGroupKind
  ): string {
    return this.trackChildKey(this.buildChildrenKey("activity-group", environment, group));
  }

  clear(environment?: JenkinsEnvironmentRef): void {
    if (!environment) {
      this.summaries.clear();
      for (const key of Array.from(this.childKeys)) {
        this.cacheManager.clearChildrenCache(key);
      }
      this.childKeys.clear();
      return;
    }

    this.summaries.delete(this.buildEnvironmentKey(environment));
    this.clearChildKey(this.buildActivityRootChildrenKey(environment));
    for (const group of ACTIVITY_GROUP_ORDER) {
      this.clearChildKey(this.buildActivityGroupChildrenKey(environment, group));
    }
  }

  // Used by legacy refresh paths that only carry an environment id, not a scope.
  clearForEnvironmentIdAcrossScopes(environmentId: string): void {
    for (const key of this.summaries.keys()) {
      if (key.endsWith(`:${environmentId}`)) {
        this.summaries.delete(key);
      }
    }
    for (const key of Array.from(this.childKeys)) {
      if (key.startsWith(`${environmentId}:`)) {
        this.clearChildKey(key);
      }
    }
  }

  private buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.scope}:${environment.environmentId}`;
  }

  private trackChildKey(key: string): string {
    this.childKeys.add(key);
    return key;
  }

  private clearChildKey(key: string): void {
    this.cacheManager.clearChildrenCache(key);
    this.childKeys.delete(key);
  }
}
