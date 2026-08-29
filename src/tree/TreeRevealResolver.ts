import type * as vscode from "vscode";
import type { JobSearchEntry } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { JenkinsFolderTreeItem, JobTreeItem } from "./items/TreeJobItems";
import { InstanceTreeItem, JobsFolderTreeItem, RootSectionTreeItem } from "./items/TreeRootItems";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";
import { retryOnTreeChange } from "./TreeChangeRetry";
import { isLoadingPlaceholder } from "./TreeDataProviderUtils";

type GetChildrenInternal = (element?: WorkbenchTreeElement) => Promise<WorkbenchTreeElement[]>;

export class JenkinsTreeRevealResolver {
  constructor(
    private readonly getChildrenInternal: GetChildrenInternal,
    private readonly onDidChangeTreeData: vscode.Event<WorkbenchTreeElement | undefined>
  ) {}

  async resolveJobElement(
    environment: JenkinsEnvironmentRef,
    entry: JobSearchEntry
  ): Promise<WorkbenchTreeElement | undefined> {
    const rootItems = await this.getLoadedChildren(undefined);
    const instancesRoot = rootItems.find(
      (item) => item instanceof RootSectionTreeItem && item.section === "instances"
    );
    if (!instancesRoot) {
      return undefined;
    }

    const instanceItems = await this.getLoadedChildren(instancesRoot);
    const instance = instanceItems.find(
      (item): item is InstanceTreeItem =>
        item instanceof InstanceTreeItem &&
        item.environmentId === environment.environmentId &&
        item.scope === environment.scope
    );
    if (!instance) {
      return undefined;
    }

    const instanceChildren = await this.getLoadedChildren(instance);
    const jobsFolder = instanceChildren.find(
      (item): item is JobsFolderTreeItem => item instanceof JobsFolderTreeItem
    );
    if (!jobsFolder) {
      return undefined;
    }

    let currentParent: WorkbenchTreeElement = jobsFolder;
    const path = entry.path;
    if (path.length === 0) {
      return undefined;
    }

    for (let index = 0; index < path.length; index += 1) {
      const segment = path[index];
      const isLast = index === path.length - 1;
      const children = await this.getLoadedChildren(currentParent);
      if (isLast) {
        // Children come from the regular (cached, filtered) loading path, so a job hidden
        // by an active job/branch filter resolves to undefined and callers fall back.
        return children.find(
          (item): item is JobTreeItem => item instanceof JobTreeItem && item.jobUrl === segment.url
        );
      }

      const folderItem = children.find(
        (item): item is JenkinsFolderTreeItem =>
          item instanceof JenkinsFolderTreeItem && item.folderUrl === segment.url
      );
      if (!folderItem) {
        return undefined;
      }
      currentParent = folderItem;
    }
    return undefined;
  }

  // Loads children through the provider's normal caching path so that the subsequent
  // treeView.reveal resolves the same cached instances. Cold caches return a loading
  // placeholder immediately; wait for the tree change fired when the load lands and
  // re-read. Retry slow Jenkins folders, but stop after a bounded number of waits
  // so a stale loading placeholder cannot leave reveal pending forever.
  private async getLoadedChildren(element?: WorkbenchTreeElement): Promise<WorkbenchTreeElement[]> {
    const children = await retryOnTreeChange({
      operation: () => this.getChildrenInternal(element),
      onDidChangeTreeData: this.onDidChangeTreeData,
      shouldRetry: (result) => result.some(isLoadingPlaceholder),
      getPendingElement: () => element,
      getPendingElementBeforeOperation: () => element,
      retryAfterTimeout: true
    });
    return children.some(isLoadingPlaceholder) ? [] : children;
  }
}
