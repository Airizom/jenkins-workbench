import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { ActivityDisplaySummary } from "../ActivityTypes";
import type { EnvironmentSummaryStore } from "../EnvironmentSummaryStore";
import { JenkinsViewTreeItem } from "../items/TreeJobItems";
import { NodeTreeItem } from "../items/TreeNodeItems";
import {
  ActivityFolderTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  type InstanceTreeItemIssue,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  ViewsFolderTreeItem
} from "../items/TreeRootItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { curateTreeViews, type TreeViewCurationOptions } from "../TreeViewCuration";
import { mapQueueItemsToTreeItems } from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreeEnvironmentChildrenLoader {
  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly pinStore: JenkinsPinStore,
    private readonly environmentSummaryStore: EnvironmentSummaryStore,
    private readonly getViewCurationOptions: () => TreeViewCurationOptions,
    private readonly getActivitySummary: (
      environment: JenkinsEnvironmentRef
    ) => ActivityDisplaySummary | undefined,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async getInstanceItems(
    resolveIssue?: (environment: EnvironmentWithScope) => InstanceTreeItemIssue | undefined
  ): Promise<WorkbenchTreeElement[]> {
    // An empty root lets VS Code render the "Connect your first Jenkins environment" welcome view.
    const environments = await this.store.listEnvironmentsWithScope();
    return environments.map(
      (environment) => new InstanceTreeItem(environment, resolveIssue?.(environment))
    );
  }

  async getInstanceChildren(element: InstanceTreeItem): Promise<WorkbenchTreeElement[]> {
    const summary = this.environmentSummaryStore.get(element);
    const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
      element.scope,
      element.environmentId
    );
    const items: WorkbenchTreeElement[] = [];
    if (pinnedEntries.length > 0) {
      items.push(new PinnedJobsFolderTreeItem(element, pinnedEntries.length));
    }
    items.push(
      new ActivityFolderTreeItem(element, this.getActivitySummary(element)),
      new ViewsFolderTreeItem(element),
      new JobsFolderTreeItem(element, summary?.jobs),
      new BuildQueueFolderTreeItem(element, summary?.queue),
      new NodesFolderTreeItem(element, summary?.nodes)
    );
    return items;
  }

  async loadViewsForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const allViews = await this.dataService.getViewsForEnvironment(environment);
      const views = curateTreeViews(allViews, this.getViewCurationOptions());
      if (views.length === 0) {
        return [
          allViews.length > 0
            ? this.placeholders.createEmptyPlaceholder(
                "All views are hidden.",
                "Click to edit the hidden view names.",
                {
                  command: {
                    command: "workbench.action.openSettings",
                    title: "Edit Hidden Views",
                    arguments: ["jenkinsWorkbench.treeViews.excludedNames"]
                  }
                }
              )
            : this.placeholders.createEmptyPlaceholder("No views", "This Jenkins has no views.")
        ];
      }

      return views.map((view) => new JenkinsViewTreeItem(environment, view.name, view.url));
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load views.", error)];
    }
  }

  async loadNodes(
    environment: JenkinsEnvironmentRef,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const nodes = await this.dataService.getNodes(environment);
      if (isCurrentLoad()) {
        this.environmentSummaryStore.updateFromNodes(environment, nodes);
      }
      if (nodes.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No nodes found.",
            "This instance has no build agents."
          )
        ];
      }
      return nodes.map((node) => new NodeTreeItem(environment, node));
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load nodes.", error)];
    }
  }

  async loadQueueForEnvironment(
    environment: JenkinsEnvironmentRef,
    isCurrentLoad: () => boolean = () => true
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const items = await this.dataService.getQueueItems(environment);
      if (isCurrentLoad()) {
        this.environmentSummaryStore.updateFromQueue(environment, items);
      }
      if (items.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "Build queue is empty.",
            "No items are waiting to run."
          )
        ];
      }
      return mapQueueItemsToTreeItems(environment, items);
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load build queue.", error)];
    }
  }
}
