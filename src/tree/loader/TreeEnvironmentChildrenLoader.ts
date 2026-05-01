import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { EnvironmentSummaryStore } from "../EnvironmentSummaryStore";
import { type TreeViewCurationOptions, curateTreeViews } from "../TreeViewCuration";
import { JenkinsViewTreeItem } from "../items/TreeJobItems";
import { NodeTreeItem } from "../items/TreeNodeItems";
import {
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  JobsFolderTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  ViewsFolderTreeItem
} from "../items/TreeRootItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { mapQueueItemsToTreeItems } from "./TreeChildrenMapping";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreeEnvironmentChildrenLoader {
  constructor(
    private readonly store: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly pinStore: JenkinsPinStore,
    private readonly environmentSummaryStore: EnvironmentSummaryStore,
    private readonly getViewCurationOptions: () => TreeViewCurationOptions,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async getInstanceItems(): Promise<WorkbenchTreeElement[]> {
    const environments = await this.store.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return [
        this.placeholders.createEmptyPlaceholder(
          "No Jenkins environments configured.",
          "Use the + command to add one."
        )
      ];
    }

    return environments.map((environment) => new InstanceTreeItem(environment));
  }

  async getInstanceChildren(element: InstanceTreeItem): Promise<WorkbenchTreeElement[]> {
    const summary = this.environmentSummaryStore.get(element);
    const pinnedEntries = await this.pinStore.listPinnedJobsForEnvironment(
      element.scope,
      element.environmentId
    );
    return [
      ...(pinnedEntries.length > 0
        ? [new PinnedJobsFolderTreeItem(element, pinnedEntries.length)]
        : []),
      new ViewsFolderTreeItem(element),
      new JobsFolderTreeItem(element, summary?.jobs),
      new BuildQueueFolderTreeItem(element, summary?.queue),
      new NodesFolderTreeItem(element, summary?.nodes)
    ];
  }

  async loadViewsForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const views = curateTreeViews(
        await this.dataService.getViewsForEnvironment(environment),
        this.getViewCurationOptions()
      );
      if (views.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No curated views found.",
            "This instance has no curated Jenkins views."
          )
        ];
      }

      return views.map((view) => new JenkinsViewTreeItem(environment, view.name, view.url));
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load views.", error)];
    }
  }

  async loadNodes(environment: JenkinsEnvironmentRef): Promise<WorkbenchTreeElement[]> {
    try {
      const nodes = await this.dataService.getNodes(environment);
      this.environmentSummaryStore.updateFromNodes(environment, nodes);
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
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const items = await this.dataService.getQueueItems(environment);
      this.environmentSummaryStore.updateFromQueue(environment, items);
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
