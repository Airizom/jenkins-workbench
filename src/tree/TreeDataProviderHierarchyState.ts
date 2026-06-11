import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  ActivityFolderTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  RootSectionTreeItem
} from "./items/TreeRootItems";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";

export class TreeDataProviderHierarchyState {
  private readonly parentMap = new WeakMap<
    WorkbenchTreeElement,
    WorkbenchTreeElement | undefined
  >();
  private readonly instanceItems = new Map<string, InstanceTreeItem>();
  private readonly queueFolderItems = new Map<string, BuildQueueFolderTreeItem>();
  private readonly activityFolderItems = new Map<string, ActivityFolderTreeItem>();

  getParent(element: WorkbenchTreeElement): WorkbenchTreeElement | undefined {
    return this.parentMap.get(element);
  }

  withParent(
    parent: WorkbenchTreeElement | undefined,
    children: WorkbenchTreeElement[]
  ): WorkbenchTreeElement[] {
    if (parent instanceof RootSectionTreeItem && parent.section === "instances") {
      this.instanceItems.clear();
    }

    for (const child of children) {
      this.parentMap.set(child, parent);
      if (child instanceof InstanceTreeItem) {
        this.instanceItems.set(this.buildEnvironmentKey(child), child);
      }
      if (child instanceof BuildQueueFolderTreeItem) {
        this.queueFolderItems.set(this.buildEnvironmentKey(child.environment), child);
      }
      if (child instanceof ActivityFolderTreeItem) {
        this.activityFolderItems.set(this.buildEnvironmentKey(child.environment), child);
      }
    }

    return children;
  }

  notifyEnvironmentInstance(environment: JenkinsEnvironmentRef): InstanceTreeItem | undefined {
    const key = this.buildEnvironmentKey(environment);
    return this.instanceItems.get(key);
  }

  notifyQueueFolderInstance(
    environment: JenkinsEnvironmentRef
  ): BuildQueueFolderTreeItem | undefined {
    return this.queueFolderItems.get(this.buildEnvironmentKey(environment));
  }

  notifyActivityFolderInstance(
    environment: JenkinsEnvironmentRef
  ): ActivityFolderTreeItem | undefined {
    return this.activityFolderItems.get(this.buildEnvironmentKey(environment));
  }

  clearEnvironment(environmentId?: string): void {
    if (environmentId) {
      for (const map of [this.instanceItems, this.queueFolderItems, this.activityFolderItems]) {
        for (const key of map.keys()) {
          if (key.endsWith(`:${environmentId}`)) {
            map.delete(key);
          }
        }
      }
      return;
    }

    this.instanceItems.clear();
    this.queueFolderItems.clear();
    this.activityFolderItems.clear();
  }

  private buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
    return `${environment.scope}:${environment.environmentId}`;
  }
}
