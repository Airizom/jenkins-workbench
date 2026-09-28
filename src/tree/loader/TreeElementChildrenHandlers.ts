import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { BuildTreeItem } from "../items/TreeBuildItems";
import { JobTreeItem, StalePinnedJobTreeItem } from "../items/TreeJobItems";
import { NodeTreeItem } from "../items/TreeNodeItems";
import { QueueItemTreeItem } from "../items/TreeQueueItems";
import {
  ActivityFolderTreeItem,
  ActivityGroupTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  ViewsFolderTreeItem
} from "../items/TreeRootItems";
import { WorkspaceDirectoryTreeItem, WorkspaceRootTreeItem } from "../items/TreeWorkspaceItems";
import type { TreeActivityChildrenLoader } from "./TreeActivityChildrenLoader";
import type { TreeBuildChildrenLoader } from "./TreeBuildChildrenLoader";
import type { TreeChildrenKeyBuilder } from "./TreeCacheKeys";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import {
  buildWorkspaceDirectoryChildrenKey,
  buildWorkspaceRootChildrenKey,
  getJobCollectionElement
} from "./TreeChildrenMapping";
import {
  createTreeElementChildrenHandler,
  type TreeElementChildrenHandler
} from "./TreeElementChildrenHandler";
import type { TreeEnvironmentChildrenLoader } from "./TreeEnvironmentChildrenLoader";
import type { TreeJobCollectionChildrenLoader } from "./TreeJobCollectionChildrenLoader";
import type { TreePinnedChildrenLoader } from "./TreePinnedChildrenLoader";
import type { TreeWorkspaceChildrenLoader } from "./TreeWorkspaceChildrenLoader";

export type TreeElementChildrenHandlerDependencies = {
  readonly cacheManager: TreeChildrenCacheManager;
  readonly environmentLoader: TreeEnvironmentChildrenLoader;
  readonly activityLoader: TreeActivityChildrenLoader;
  readonly jobCollectionLoader: TreeJobCollectionChildrenLoader;
  readonly buildLoader: TreeBuildChildrenLoader;
  readonly workspaceLoader: TreeWorkspaceChildrenLoader;
  readonly pinnedLoader: TreePinnedChildrenLoader;
  readonly buildChildrenKey: TreeChildrenKeyBuilder;
  readonly clearChildrenCacheForEnvironment: (environment?: JenkinsEnvironmentRef | string) => void;
  readonly clearQueueCache: (environment: JenkinsEnvironmentRef) => void;
  readonly invalidateBuildArtifacts: (
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: BuildTreeItem["jobScope"]
  ) => void;
};

export function createTreeElementChildrenHandlers({
  cacheManager,
  environmentLoader,
  activityLoader,
  jobCollectionLoader,
  buildLoader,
  workspaceLoader,
  pinnedLoader,
  buildChildrenKey,
  clearChildrenCacheForEnvironment,
  clearQueueCache,
  invalidateBuildArtifacts
}: TreeElementChildrenHandlerDependencies): TreeElementChildrenHandler[] {
  return [
    createTreeElementChildrenHandler(InstanceTreeItem, {
      getChildren: (element) => environmentLoader.getInstanceChildren(element),
      invalidate: (element) => clearChildrenCacheForEnvironment(element)
    }),
    createTreeElementChildrenHandler(ActivityFolderTreeItem, {
      getChildren: (folder) => {
        return cacheManager.getOrLoadChildren(
          activityLoader.buildActivityRootChildrenKey(folder.environment),
          folder,
          (isCurrentLoad) => activityLoader.loadActivityGroups(folder, isCurrentLoad),
          "Loading activity..."
        );
      },
      invalidate: (folder) => {
        activityLoader.clearActivityData(folder.environment);
      }
    }),
    createTreeElementChildrenHandler(ActivityGroupTreeItem, {
      getChildren: (group) => {
        return cacheManager.getOrLoadChildren(
          activityLoader.buildActivityGroupChildrenKey(group.environment, group.group),
          group,
          (isCurrentLoad) => activityLoader.loadActivityGroup(group, isCurrentLoad),
          "Loading activity group..."
        );
      },
      invalidate: (group) => {
        cacheManager.clearChildrenCache(
          activityLoader.buildActivityGroupChildrenKey(group.environment, group.group)
        );
      }
    }),
    createTreeElementChildrenHandler(PinnedJobsFolderTreeItem, {
      getChildren: (folder) => {
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("pinned-root", folder.environment),
          folder,
          () => pinnedLoader.loadPinnedItemsForEnvironment(folder.environment),
          "Loading pinned jobs..."
        );
      },
      invalidate: (folder) =>
        cacheManager.clearChildrenCache(buildChildrenKey("pinned-root", folder.environment))
    }),
    createTreeElementChildrenHandler(ViewsFolderTreeItem, {
      getChildren: (folder) => {
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("views", folder.environment),
          folder,
          () => environmentLoader.loadViewsForEnvironment(folder.environment),
          "Loading views..."
        );
      },
      invalidate: (folder) =>
        cacheManager.clearChildrenCache(buildChildrenKey("views", folder.environment))
    }),
    {
      matches: (element) => Boolean(getJobCollectionElement(element)),
      getChildren: (element) => jobCollectionLoader.getJobCollectionChildren(element),
      invalidate: (element) => jobCollectionLoader.invalidateJobCollectionChildren(element)
    },
    createTreeElementChildrenHandler(JobTreeItem, {
      getChildren: (job) =>
        job.presentation === "job"
          ? buildLoader.loadJobChildrenWithWorkspace(job)
          : buildLoader.loadBuildChildren(job),
      invalidate: (job) => {
        cacheManager.clearChildrenCache(
          buildLoader.buildBuildsChildrenKey(job.environment, job.jobUrl, job.jobScope)
        );
        if (job.presentation === "job") {
          cacheManager.clearWorkspaceChildrenForJob(job.environment, job.jobUrl, job.jobScope);
        }
      }
    }),
    createTreeElementChildrenHandler(StalePinnedJobTreeItem, {
      invalidate: (job) =>
        cacheManager.clearChildrenCache(buildChildrenKey("pinned-root", job.environment))
    }),
    createTreeElementChildrenHandler(BuildTreeItem, {
      getChildren: (build) => {
        return cacheManager.getOrLoadChildren(
          buildLoader.buildBuildArtifactsKey(build.environment, build.buildUrl, build.jobScope),
          build,
          (isCurrentLoad) => buildLoader.loadArtifactsForBuild(build, isCurrentLoad),
          "Loading artifacts..."
        );
      },
      invalidate: (build) => {
        invalidateBuildArtifacts(build.environment, build.buildUrl, build.jobScope);
      }
    }),
    createTreeElementChildrenHandler(WorkspaceRootTreeItem, {
      getChildren: (workspace) => {
        return cacheManager.getOrLoadChildren(
          buildWorkspaceRootChildrenKey(
            buildChildrenKey,
            workspace.environment,
            workspace.jobUrl,
            workspace.jobScope
          ),
          workspace,
          () =>
            workspaceLoader.loadWorkspaceDirectory(
              workspace.environment,
              workspace.jobUrl,
              workspace.jobScope
            ),
          "Loading workspace..."
        );
      },
      invalidate: (workspace) => {
        cacheManager.clearWorkspaceChildrenForJob(
          workspace.environment,
          workspace.jobUrl,
          workspace.jobScope
        );
      }
    }),
    createTreeElementChildrenHandler(WorkspaceDirectoryTreeItem, {
      getChildren: (directory) => {
        return cacheManager.getOrLoadChildren(
          buildWorkspaceDirectoryChildrenKey(
            buildChildrenKey,
            directory.environment,
            directory.jobUrl,
            directory.jobScope,
            directory.relativePath
          ),
          directory,
          () =>
            workspaceLoader.loadWorkspaceDirectory(
              directory.environment,
              directory.jobUrl,
              directory.jobScope,
              directory.relativePath
            ),
          "Loading workspace folder..."
        );
      },
      invalidate: (directory) => {
        cacheManager.clearWorkspaceDirectorySubtree(
          directory.environment,
          directory.jobUrl,
          directory.jobScope,
          directory.relativePath
        );
      }
    }),
    createTreeElementChildrenHandler(NodesFolderTreeItem, {
      getChildren: (folder) => {
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("nodes", folder.environment),
          folder,
          (isCurrentLoad) => environmentLoader.loadNodes(folder.environment, isCurrentLoad),
          "Loading nodes..."
        );
      },
      invalidate: (folder) =>
        cacheManager.clearChildrenCache(buildChildrenKey("nodes", folder.environment))
    }),
    createTreeElementChildrenHandler(NodeTreeItem, {
      invalidate: (node) =>
        cacheManager.clearChildrenCache(buildChildrenKey("nodes", node.environment))
    }),
    createTreeElementChildrenHandler(BuildQueueFolderTreeItem, {
      getChildren: (folder) => {
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("queue", folder.environment),
          folder,
          (isCurrentLoad) =>
            environmentLoader.loadQueueForEnvironment(folder.environment, isCurrentLoad),
          "Loading build queue..."
        );
      },
      invalidate: (folder) => clearQueueCache(folder.environment)
    }),
    createTreeElementChildrenHandler(QueueItemTreeItem, {
      invalidate: (item) => clearQueueCache(item.environment)
    })
  ];
}
