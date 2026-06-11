import type {
  JenkinsJobCollectionRequest as JenkinsDataJobCollectionRequest,
  JenkinsJobInfo,
  JenkinsQueueItemInfo
} from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsTreeFilter } from "../TreeFilter";
import {
  ROOT_TREE_JOB_SCOPE,
  type TreeJobCollectionRequest,
  type TreeJobScope,
  buildTreeJobScopeKey,
  getTreeJobCollectionCacheParts
} from "../TreeJobScope";
import {
  JenkinsFolderTreeItem,
  JenkinsViewTreeItem,
  JobTreeItem,
  PipelineTreeItem
} from "../items/TreeJobItems";
import { QueueItemTreeItem } from "../items/TreeQueueItems";
import { JobsFolderTreeItem, PinnedSectionTreeItem } from "../items/TreeRootItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";

export type JobCollectionTreeElement =
  | JobsFolderTreeItem
  | JenkinsViewTreeItem
  | JenkinsFolderTreeItem;

export function getJobCollectionElement(
  element: WorkbenchTreeElement
): JobCollectionTreeElement | undefined {
  if (
    element instanceof JobsFolderTreeItem ||
    element instanceof JenkinsViewTreeItem ||
    element instanceof JenkinsFolderTreeItem
  ) {
    return element;
  }

  return undefined;
}

export function getJobCollectionRequest(
  element: JobCollectionTreeElement
): TreeJobCollectionRequest {
  if (element instanceof JenkinsFolderTreeItem) {
    return {
      scope: element.jobScope,
      folderUrl: element.folderUrl
    };
  }

  return {
    scope: element.jobScope
  };
}

export function buildJobCollectionChildrenKey(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  request: TreeJobCollectionRequest
): string {
  const cacheParts = getTreeJobCollectionCacheParts(request);
  return buildChildrenKey(cacheParts.kind, environment, cacheParts.extra);
}

export function getJobCollectionLoadingLabel(request: TreeJobCollectionRequest): string {
  if (request.folderUrl) {
    return "Loading folder items...";
  }

  if (request.scope.kind === "view") {
    return "Loading view items...";
  }

  return "Loading jobs...";
}

export function buildScopedTreeExtra(scope: TreeJobScope, resourceUrl: string): string {
  return `${buildTreeJobScopeKey(scope)}::${resourceUrl}`;
}

export function buildBuildsChildrenKey(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope
): string {
  return buildChildrenKey("builds", environment, buildScopedTreeExtra(jobScope, jobUrl));
}

export function buildBuildArtifactsKey(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  jobScope: TreeJobScope
): string {
  return buildChildrenKey("build-artifacts", environment, buildScopedTreeExtra(jobScope, buildUrl));
}

export function buildArtifactChildrenKey(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  buildUrl: string,
  jobScope: TreeJobScope
): string {
  return buildChildrenKey("artifacts", environment, buildScopedTreeExtra(jobScope, buildUrl));
}

export function buildWorkspaceRootChildrenKey(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope
): string {
  return buildChildrenKey("workspace", environment, buildScopedTreeExtra(jobScope, jobUrl));
}

export function buildWorkspaceDirectoryChildrenKey(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope,
  relativePath: string
): string {
  return buildChildrenKey(
    "workspace-dir",
    environment,
    `${buildScopedTreeExtra(jobScope, jobUrl)}::${relativePath}`
  );
}

export function buildWorkspaceDirectoryChildrenPrefix(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope
): string {
  return buildChildrenKey(
    "workspace-dir",
    environment,
    `${buildScopedTreeExtra(jobScope, jobUrl)}::`
  );
}

export function buildWorkspaceDirectorySubtreePrefix(
  buildChildrenKey: (kind: string, environment: JenkinsEnvironmentRef, extra?: string) => string,
  environment: JenkinsEnvironmentRef,
  jobUrl: string,
  jobScope: TreeJobScope,
  relativePath: string
): string {
  return `${buildWorkspaceDirectoryChildrenKey(buildChildrenKey, environment, jobUrl, jobScope, relativePath)}/`;
}

export function toJenkinsJobCollectionRequest(
  request: TreeJobCollectionRequest
): JenkinsDataJobCollectionRequest {
  if (request.scope.kind === "view") {
    return {
      scope: {
        kind: "view",
        viewUrl: request.scope.viewUrl
      },
      folderUrl: request.folderUrl
    };
  }

  return {
    scope: {
      kind: "root"
    },
    folderUrl: request.folderUrl
  };
}

export function mapFilteredJobsToTreeItems(
  environment: JenkinsEnvironmentRef,
  filteredJobs: JenkinsJobInfo[],
  treeFilter: JenkinsTreeFilter,
  jobScope: TreeJobScope | undefined,
  watchedJobs: Set<string>,
  pinnedJobs: Set<string>
): WorkbenchTreeElement[] {
  const hasWatchedJobs = watchedJobs.size > 0;
  const hasPinnedJobs = pinnedJobs.size > 0;

  if (!hasPinnedJobs) {
    const items: WorkbenchTreeElement[] = [];
    for (const job of filteredJobs) {
      items.push(
        createJobTreeItem(
          environment,
          job,
          treeFilter,
          jobScope,
          hasWatchedJobs && watchedJobs.has(job.url),
          false
        )
      );
    }

    return items;
  }

  const pinnedItems: WorkbenchTreeElement[] = [];
  const unpinnedItems: WorkbenchTreeElement[] = [];

  for (const job of filteredJobs) {
    const isPinned = pinnedJobs.has(job.url);
    const item = createJobTreeItem(
      environment,
      job,
      treeFilter,
      jobScope,
      hasWatchedJobs && watchedJobs.has(job.url),
      isPinned
    );
    if (isPinned && isPinnedJobTreeItem(item)) {
      pinnedItems.push(item);
    } else {
      unpinnedItems.push(item);
    }
  }

  if (pinnedItems.length > 0) {
    return [new PinnedSectionTreeItem(), ...pinnedItems, ...unpinnedItems];
  }

  return unpinnedItems;
}

export function mapQueueItemsToTreeItems(
  environment: JenkinsEnvironmentRef,
  items: JenkinsQueueItemInfo[]
): WorkbenchTreeElement[] {
  return items.map((item) => new QueueItemTreeItem(environment, item));
}

function createJobTreeItem(
  environment: JenkinsEnvironmentRef,
  job: JenkinsJobInfo,
  treeFilter: JenkinsTreeFilter,
  jobScope: TreeJobScope | undefined,
  isWatched: boolean,
  isPinned: boolean
): WorkbenchTreeElement {
  switch (job.kind) {
    case "folder":
    case "multibranch":
      return createFolderTreeItem(environment, job, treeFilter, jobScope);
    case "pipeline":
      return new PipelineTreeItem(
        environment,
        job.name,
        job.url,
        jobScope,
        job.color,
        isWatched,
        isPinned
      );
    default:
      return new JobTreeItem(
        environment,
        job.name,
        job.url,
        jobScope,
        job.color,
        isWatched,
        isPinned
      );
  }
}

function isPinnedJobTreeItem(item: WorkbenchTreeElement): item is JobTreeItem | PipelineTreeItem {
  return item instanceof JobTreeItem || item instanceof PipelineTreeItem;
}

function createFolderTreeItem(
  environment: JenkinsEnvironmentRef,
  job: JenkinsJobInfo,
  treeFilter: JenkinsTreeFilter,
  scope?: TreeJobScope
): JenkinsFolderTreeItem {
  const resolvedScope = scope ?? ROOT_TREE_JOB_SCOPE;
  const branchFilter =
    job.kind === "multibranch"
      ? treeFilter.getBranchFilter(environment.environmentId, job.url)
      : undefined;
  return new JenkinsFolderTreeItem(environment, job.name, job.url, job.kind, resolvedScope, {
    branchFilter
  });
}
