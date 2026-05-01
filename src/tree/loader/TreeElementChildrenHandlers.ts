import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { BuildArtifactsFolderTreeItem, BuildTreeItem } from "../items/TreeBuildItems";
import { JobTreeItem, PipelineTreeItem, StalePinnedJobTreeItem } from "../items/TreeJobItems";
import { NodeTreeItem } from "../items/TreeNodeItems";
import { QueueItemTreeItem } from "../items/TreeQueueItems";
import {
  ActivityFolderTreeItem,
  ActivityGroupTreeItem,
  BuildQueueFolderTreeItem,
  InstanceTreeItem,
  NodesFolderTreeItem,
  PinnedJobsFolderTreeItem,
  RootSectionTreeItem,
  ViewsFolderTreeItem
} from "../items/TreeRootItems";
import { WorkspaceDirectoryTreeItem, WorkspaceRootTreeItem } from "../items/TreeWorkspaceItems";
import type { TreeActivityChildrenLoader } from "./TreeActivityChildrenLoader";
import type { TreeBuildChildrenLoader } from "./TreeBuildChildrenLoader";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import { getJobCollectionElement } from "./TreeChildrenMapping";
import type { TreeElementChildrenHandler } from "./TreeElementChildrenHandler";
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
  readonly buildChildrenKey: BuildChildrenKey;
  readonly clearChildrenCacheForEnvironment: (environment?: JenkinsEnvironmentRef | string) => void;
  readonly clearQueueCache: (environment: JenkinsEnvironmentRef) => void;
  readonly invalidateBuildArtifacts: (
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    jobScope: BuildTreeItem["jobScope"]
  ) => void;
};

type BuildChildrenKey = (
  kind: string,
  environment: JenkinsEnvironmentRef,
  extra?: string
) => string;

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
    {
      matches: (element) => element instanceof RootSectionTreeItem,
      getChildren: () => environmentLoader.getInstanceItems(),
      invalidate: () => clearChildrenCacheForEnvironment()
    },
    {
      matches: (element) => element instanceof InstanceTreeItem,
      getChildren: (element) => environmentLoader.getInstanceChildren(element as InstanceTreeItem),
      invalidate: (element) => clearChildrenCacheForEnvironment(element as InstanceTreeItem)
    },
    {
      matches: (element) => element instanceof ActivityFolderTreeItem,
      getChildren: (element) => {
        const folder = element as ActivityFolderTreeItem;
        return cacheManager.getOrLoadChildren(
          activityLoader.buildActivityRootChildrenKey(folder.environment),
          folder,
          (isCurrentLoad) => activityLoader.loadActivityGroups(folder, isCurrentLoad),
          "Loading activity..."
        );
      },
      invalidate: (element) => {
        activityLoader.clearActivityData((element as ActivityFolderTreeItem).environment);
      }
    },
    {
      matches: (element) => element instanceof ActivityGroupTreeItem,
      getChildren: (element) => {
        const group = element as ActivityGroupTreeItem;
        return cacheManager.getOrLoadChildren(
          activityLoader.buildActivityGroupChildrenKey(group.environment, group.group),
          group,
          (isCurrentLoad) => activityLoader.loadActivityGroup(group, isCurrentLoad),
          "Loading activity group..."
        );
      },
      invalidate: (element) => {
        const group = element as ActivityGroupTreeItem;
        cacheManager.clearChildrenCache(
          activityLoader.buildActivityGroupChildrenKey(group.environment, group.group)
        );
      }
    },
    {
      matches: (element) => element instanceof PinnedJobsFolderTreeItem,
      getChildren: (element) => {
        const folder = element as PinnedJobsFolderTreeItem;
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("pinned-root", folder.environment),
          folder,
          () => pinnedLoader.loadPinnedItemsForEnvironment(folder.environment),
          "Loading pinned jobs..."
        );
      },
      invalidate: (element) =>
        cacheManager.clearChildrenCache(
          buildChildrenKey("pinned-root", (element as PinnedJobsFolderTreeItem).environment)
        )
    },
    {
      matches: (element) => element instanceof ViewsFolderTreeItem,
      getChildren: (element) => {
        const folder = element as ViewsFolderTreeItem;
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("views", folder.environment),
          folder,
          () => environmentLoader.loadViewsForEnvironment(folder.environment),
          "Loading views..."
        );
      },
      invalidate: (element) =>
        cacheManager.clearChildrenCache(
          buildChildrenKey("views", (element as ViewsFolderTreeItem).environment)
        )
    },
    {
      matches: (element) => Boolean(getJobCollectionElement(element)),
      getChildren: (element, options) =>
        jobCollectionLoader.getJobCollectionChildren(element, options),
      invalidate: (element) => jobCollectionLoader.invalidateJobCollectionChildren(element)
    },
    {
      matches: (element) => element instanceof JobTreeItem,
      getChildren: (element) => buildLoader.loadJobChildrenWithWorkspace(element as JobTreeItem),
      invalidate: (element) => {
        const job = element as JobTreeItem;
        cacheManager.clearChildrenCache(
          buildLoader.buildBuildsChildrenKey(job.environment, job.jobUrl, job.jobScope)
        );
        cacheManager.clearWorkspaceChildrenForJob(job.environment, job.jobUrl, job.jobScope);
      }
    },
    {
      matches: (element) => element instanceof PipelineTreeItem,
      getChildren: (element) => buildLoader.loadBuildChildren(element as PipelineTreeItem),
      invalidate: (element) => {
        const pipeline = element as PipelineTreeItem;
        cacheManager.clearChildrenCache(
          buildLoader.buildBuildsChildrenKey(
            pipeline.environment,
            pipeline.jobUrl,
            pipeline.jobScope
          )
        );
      }
    },
    {
      matches: (element) => element instanceof StalePinnedJobTreeItem,
      invalidate: (element) =>
        cacheManager.clearChildrenCache(
          buildChildrenKey("pinned-root", (element as StalePinnedJobTreeItem).environment)
        )
    },
    {
      matches: (element) => element instanceof BuildTreeItem,
      getChildren: (element) => {
        const build = element as BuildTreeItem;
        return cacheManager.getOrLoadChildren(
          buildLoader.buildBuildArtifactsKey(build.environment, build.buildUrl, build.jobScope),
          build,
          () => buildLoader.loadArtifactsSummaryForBuild(build),
          "Loading artifacts..."
        );
      },
      invalidate: (element) => {
        const build = element as BuildTreeItem;
        invalidateBuildArtifacts(build.environment, build.buildUrl, build.jobScope);
      }
    },
    {
      matches: (element) => element instanceof BuildArtifactsFolderTreeItem,
      getChildren: (element) => {
        const folder = element as BuildArtifactsFolderTreeItem;
        return cacheManager.getOrLoadChildren(
          buildLoader.buildArtifactChildrenKey(
            folder.environment,
            folder.buildUrl,
            folder.jobScope
          ),
          folder,
          () => buildLoader.loadArtifactsForBuild(folder),
          "Loading artifacts..."
        );
      },
      invalidate: (element) => {
        const folder = element as BuildArtifactsFolderTreeItem;
        invalidateBuildArtifacts(folder.environment, folder.buildUrl, folder.jobScope);
        cacheManager.clearChildrenCache(
          buildLoader.buildArtifactChildrenKey(folder.environment, folder.buildUrl, folder.jobScope)
        );
      }
    },
    {
      matches: (element) => element instanceof WorkspaceRootTreeItem,
      getChildren: (element) => {
        const workspace = element as WorkspaceRootTreeItem;
        return cacheManager.getOrLoadChildren(
          workspaceLoader.buildWorkspaceRootChildrenKey(
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
      invalidate: (element) => {
        const workspace = element as WorkspaceRootTreeItem;
        cacheManager.clearWorkspaceChildrenForJob(
          workspace.environment,
          workspace.jobUrl,
          workspace.jobScope
        );
      }
    },
    {
      matches: (element) => element instanceof WorkspaceDirectoryTreeItem,
      getChildren: (element) => {
        const directory = element as WorkspaceDirectoryTreeItem;
        return cacheManager.getOrLoadChildren(
          workspaceLoader.buildWorkspaceDirectoryChildrenKey(
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
      invalidate: (element) => {
        const directory = element as WorkspaceDirectoryTreeItem;
        cacheManager.clearWorkspaceDirectorySubtree(
          directory.environment,
          directory.jobUrl,
          directory.jobScope,
          directory.relativePath
        );
      }
    },
    {
      matches: (element) => element instanceof NodesFolderTreeItem,
      getChildren: (element) => {
        const folder = element as NodesFolderTreeItem;
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("nodes", folder.environment),
          folder,
          () => environmentLoader.loadNodes(folder.environment),
          "Loading nodes..."
        );
      },
      invalidate: (element) =>
        cacheManager.clearChildrenCache(
          buildChildrenKey("nodes", (element as NodesFolderTreeItem).environment)
        )
    },
    {
      matches: (element) => element instanceof NodeTreeItem,
      invalidate: (element) =>
        cacheManager.clearChildrenCache(
          buildChildrenKey("nodes", (element as NodeTreeItem).environment)
        )
    },
    {
      matches: (element) => element instanceof BuildQueueFolderTreeItem,
      getChildren: (element) => {
        const folder = element as BuildQueueFolderTreeItem;
        return cacheManager.getOrLoadChildren(
          buildChildrenKey("queue", folder.environment),
          folder,
          () => environmentLoader.loadQueueForEnvironment(folder.environment),
          "Loading build queue..."
        );
      },
      invalidate: (element) => clearQueueCache((element as BuildQueueFolderTreeItem).environment)
    },
    {
      matches: (element) => element instanceof QueueItemTreeItem,
      invalidate: (element) => clearQueueCache((element as QueueItemTreeItem).environment)
    }
  ];
}
