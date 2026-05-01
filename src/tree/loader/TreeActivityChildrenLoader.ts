import type { BuildListFetchOptions } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  ActivityDisplaySummary,
  ActivityGroupKind,
  ActivityJobViewModel,
  ActivityViewModel,
  TreeActivityOptions
} from "../ActivityTypes";
import { ROOT_TREE_JOB_SCOPE } from "../TreeJobScope";
import type { ActivityCollector } from "../activity/ActivityCollector";
import { ActivityJobTreeItem, ActivityPipelineTreeItem } from "../items/TreeJobItems";
import { ActivityFolderTreeItem, ActivityGroupTreeItem } from "../items/TreeRootItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { TreeActivityCache } from "./TreeActivityCache";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import type { TreeJobUrlStateLoader } from "./TreeJobUrlStateLoader";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreeActivityChildrenLoader {
  private readonly activityCache: TreeActivityCache;
  private readonly refreshEnvironmentKeys = new Set<string>();

  constructor(
    private readonly collector: ActivityCollector,
    cacheManager: TreeChildrenCacheManager,
    private readonly jobUrlState: TreeJobUrlStateLoader,
    buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
    private activityOptions: TreeActivityOptions,
    private readonly getBuildListFetchOptions: () => BuildListFetchOptions,
    private readonly placeholders: TreePlaceholderFactory,
    private readonly notifyEnvironment: (environment: JenkinsEnvironmentRef) => void
  ) {
    this.activityCache = new TreeActivityCache(cacheManager, buildChildrenKey);
  }

  getSummary(environment: JenkinsEnvironmentRef): ActivityDisplaySummary | undefined {
    return this.activityCache.getSummary(environment);
  }

  updateOptions(options: TreeActivityOptions): void {
    this.activityOptions = options;
  }

  async loadActivityGroups(
    folder: ActivityFolderTreeItem,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const viewModel = await this.collectActivity(folder.environment);
      if (!isCurrentLoad()) {
        return [];
      }
      this.activityCache.setSummary(folder.environment, viewModel.summary);
      this.notifyEnvironment(folder.environment);

      const groups: ActivityGroupTreeItem[] = [];
      for (const group of viewModel.groups) {
        const children = await this.mapEntriesToTreeItems(folder.environment, group.items);
        if (!isCurrentLoad()) {
          return [];
        }
        this.activityCache.setGroupChildren(folder.environment, group.kind, children);
        if (children.length > 0) {
          groups.push(
            new ActivityGroupTreeItem(
              folder.environment,
              group.kind,
              group.displayedCount,
              group.isTruncated
            )
          );
        }
      }

      if (groups.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No current activity.",
            "No running, failing, unstable, or input-blocked jobs were found."
          )
        ];
      }

      return groups;
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load activity.", error)];
    }
  }

  async loadActivityGroup(
    groupItem: ActivityGroupTreeItem,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    const cached = this.activityCache.getGroupChildren(groupItem.environment, groupItem.group);
    if (cached) {
      return cached;
    }

    await this.loadActivityGroups(new ActivityFolderTreeItem(groupItem.environment), isCurrentLoad);
    if (!isCurrentLoad()) {
      return [];
    }
    return (
      this.activityCache.getGroupChildren(groupItem.environment, groupItem.group) ?? [
        this.placeholders.createEmptyPlaceholder(
          "No matching jobs.",
          "This activity group is currently empty."
        )
      ]
    );
  }

  buildActivityRootChildrenKey(environment: JenkinsEnvironmentRef): string {
    return this.activityCache.buildActivityRootChildrenKey(environment);
  }

  buildActivityGroupChildrenKey(
    environment: JenkinsEnvironmentRef,
    group: ActivityGroupKind
  ): string {
    return this.activityCache.buildActivityGroupChildrenKey(environment, group);
  }

  clearActivityData(environment?: JenkinsEnvironmentRef): void {
    this.activityCache.clear(environment);
  }

  refreshActivityData(environment: JenkinsEnvironmentRef): void {
    this.refreshEnvironmentKeys.add(this.buildEnvironmentKey(environment));
    this.clearActivityData(environment);
  }

  clearActivityDataForEnvironmentIdAcrossScopes(environmentId: string): void {
    this.activityCache.clearForEnvironmentIdAcrossScopes(environmentId);
  }

  private async collectActivity(environment: JenkinsEnvironmentRef): Promise<ActivityViewModel> {
    const environmentKey = this.buildEnvironmentKey(environment);
    const shouldBypassCache = this.refreshEnvironmentKeys.delete(environmentKey);
    return this.collector.collect(environment, {
      activityOptions: this.activityOptions,
      buildListFetchOptions: this.getBuildListFetchOptions(),
      bypassCache: shouldBypassCache
    });
  }

  private async mapEntriesToTreeItems(
    environment: JenkinsEnvironmentRef,
    entries: ActivityJobViewModel[]
  ): Promise<WorkbenchTreeElement[]> {
    if (entries.length === 0) {
      return [];
    }

    const [watchedJobs, pinnedJobs] = await Promise.all([
      this.jobUrlState.getWatchedJobUrls(environment),
      this.jobUrlState.getPinnedJobUrls(environment)
    ]);

    return entries.map((entry) => {
      const isWatched = watchedJobs.has(entry.url);
      const isPinned = pinnedJobs.has(entry.url);
      if (entry.kind === "pipeline") {
        return new ActivityPipelineTreeItem(
          environment,
          entry.name,
          entry.url,
          ROOT_TREE_JOB_SCOPE,
          entry.color,
          isWatched,
          isPinned,
          entry.group,
          entry.pathContext
        );
      }
      return new ActivityJobTreeItem(
        environment,
        entry.name,
        entry.url,
        ROOT_TREE_JOB_SCOPE,
        entry.color,
        isWatched,
        isPinned,
        entry.group,
        entry.pathContext
      );
    });
  }

  private buildEnvironmentKey(
    environment: Pick<JenkinsEnvironmentRef, "environmentId" | "scope">
  ): string {
    return `${environment.scope}:${environment.environmentId}`;
  }
}
