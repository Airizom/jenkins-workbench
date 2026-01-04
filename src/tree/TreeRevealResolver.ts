import type { JobSearchEntry } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { buildOverrideKey } from "./TreeFilterKeys";
import {
  InstanceTreeItem,
  JenkinsFolderTreeItem,
  JobTreeItem,
  JobsFolderTreeItem,
  PipelineTreeItem,
  RootSectionTreeItem,
  type WorkbenchTreeElement
} from "./TreeItems";
import type { TreeChildrenOptions } from "./TreeTypes";

type GetChildrenInternal = (
  element?: WorkbenchTreeElement,
  options?: TreeChildrenOptions
) => Promise<WorkbenchTreeElement[]>;

export class JenkinsTreeRevealResolver {
  constructor(private readonly getChildrenInternal: GetChildrenInternal) {}

  async resolveJobElement(
    environment: JenkinsEnvironmentRef,
    entry: JobSearchEntry
  ): Promise<WorkbenchTreeElement | undefined> {
    const overrideKeys = new Set<string>([buildOverrideKey(environment, entry.url)]);
    const rootItems = await this.getChildrenInternal(undefined, { overrideKeys });
    const instancesRoot = rootItems.find(
      (item) => item instanceof RootSectionTreeItem && item.section === "instances"
    );
    if (!instancesRoot) {
      return undefined;
    }

    const instanceItems = await this.getChildrenInternal(instancesRoot, {
      overrideKeys
    });
    const instance = instanceItems.find(
      (item): item is InstanceTreeItem =>
        item instanceof InstanceTreeItem &&
        item.environmentId === environment.environmentId &&
        item.scope === environment.scope
    );
    if (!instance) {
      return undefined;
    }

    const instanceChildren = await this.getChildrenInternal(instance, {
      overrideKeys
    });
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
      const children = await this.getChildrenInternal(currentParent, {
        overrideKeys
      });
      if (isLast) {
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
}
