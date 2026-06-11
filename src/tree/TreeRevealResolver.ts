import type * as vscode from "vscode";
import type { JobSearchEntry } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { isLoadingPlaceholder } from "./TreeDataProviderUtils";
import { JenkinsFolderTreeItem, JobTreeItem, PipelineTreeItem } from "./items/TreeJobItems";
import { InstanceTreeItem, JobsFolderTreeItem, RootSectionTreeItem } from "./items/TreeRootItems";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";

type GetChildrenInternal = (element?: WorkbenchTreeElement) => Promise<WorkbenchTreeElement[]>;

type TreeChangeWaiter = {
  didChange: Promise<boolean>;
  dispose: () => void;
};

const LOAD_RETRY_TIMEOUT_MS = 4000;

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
          (item): item is JobTreeItem | PipelineTreeItem =>
            (item instanceof JobTreeItem || item instanceof PipelineTreeItem) &&
            item.jobUrl === segment.url
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
  // re-read. Timeouts only trigger another poll so slow Jenkins folders are not
  // treated as absent while the underlying load is still in flight.
  private async getLoadedChildren(element?: WorkbenchTreeElement): Promise<WorkbenchTreeElement[]> {
    for (;;) {
      // Subscribe before fetching so a load completing immediately is not missed.
      const waiter = this.createTreeChangeWaiter(LOAD_RETRY_TIMEOUT_MS);
      const children = await this.getChildrenInternal(element);
      if (!children.some(isLoadingPlaceholder)) {
        waiter.dispose();
        return children;
      }
      await waiter.didChange;
    }
  }

  private createTreeChangeWaiter(timeoutMs: number): TreeChangeWaiter {
    let settle: ((didChange: boolean) => void) | undefined;
    const didChange = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const finish = (result: boolean) => {
      if (!settle) {
        return;
      }
      const resolve = settle;
      settle = undefined;
      subscription.dispose();
      clearTimeout(timer);
      resolve(result);
    };
    const subscription = this.onDidChangeTreeData(() => finish(true));
    const timer = setTimeout(() => finish(false), timeoutMs);
    return { didChange, dispose: () => finish(false) };
  }
}
