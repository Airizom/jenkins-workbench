import type { JenkinsJobKind } from "../../jenkins/JenkinsClient";
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
import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
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

export function mapJobsToTreeItems(
  environment: JenkinsEnvironmentRef,
  jobs: JenkinsJobInfo[],
  treeFilter: JenkinsTreeFilter,
  options: {
    parentFolderKind?: JenkinsJobKind;
    parentFolderUrl?: string;
    overrideKeys?: Set<string>;
    jobScope?: TreeJobScope;
  },
  watchedJobs: Set<string>,
  pinnedJobs: Set<string>,
  createEmptyPlaceholder: (label: string, description?: string) => PlaceholderTreeItem
): WorkbenchTreeElement[] {
  if (jobs.length === 0) {
    return [
      createEmptyPlaceholder("No jobs, folders, or pipelines found.", "This location is empty.")
    ];
  }

  const filteredJobs = treeFilter.filterJobs(
    environment,
    jobs,
    {
      parentFolderKind: options.parentFolderKind,
      parentFolderUrl: options.parentFolderUrl
    },
    options.overrideKeys
  );

  if (filteredJobs.length === 0) {
    return [
      createEmptyPlaceholder(
        "No jobs match the current filters.",
        "Adjust or clear filters via the filter menu."
      )
    ];
  }

  const orderedJobs = orderPinnedJobsFirst(filteredJobs, pinnedJobs);
  const pinnedItems: WorkbenchTreeElement[] = [];
  const unpinnedItems: WorkbenchTreeElement[] = [];

  for (const job of orderedJobs) {
    const isWatched = watchedJobs.has(job.url);
    const isPinned = pinnedJobs.has(job.url);
    let item: WorkbenchTreeElement;
    switch (job.kind) {
      case "folder":
      case "multibranch":
        item = createFolderTreeItem(environment, job, treeFilter, options.jobScope);
        break;
      case "pipeline":
        item = new PipelineTreeItem(
          environment,
          job.name,
          job.url,
          options.jobScope,
          job.color,
          isWatched,
          isPinned
        );
        break;
      default:
        item = new JobTreeItem(
          environment,
          job.name,
          job.url,
          options.jobScope,
          job.color,
          isWatched,
          isPinned
        );
        break;
    }
    if (isPinned && (item instanceof JobTreeItem || item instanceof PipelineTreeItem)) {
      pinnedItems.push(item);
    } else {
      unpinnedItems.push(item);
    }
  }

  if (pinnedItems.length > 0) {
    return [new PinnedSectionTreeItem(), ...pinnedItems, ...unpinnedItems];
  }

  return [...pinnedItems, ...unpinnedItems];
}

export function mapQueueItemsToTreeItems(
  environment: JenkinsEnvironmentRef,
  items: JenkinsQueueItemInfo[]
): WorkbenchTreeElement[] {
  return items.map((item) => new QueueItemTreeItem(environment, item));
}

function orderPinnedJobsFirst(jobs: JenkinsJobInfo[], pinnedJobs: Set<string>): JenkinsJobInfo[] {
  if (pinnedJobs.size === 0) {
    return jobs;
  }

  const pinned: JenkinsJobInfo[] = [];
  const unpinned: JenkinsJobInfo[] = [];

  for (const job of jobs) {
    const isPinnable = job.kind === "job" || job.kind === "pipeline";
    if (isPinnable && pinnedJobs.has(job.url)) {
      pinned.push(job);
    } else {
      unpinned.push(job);
    }
  }

  if (pinned.length === 0) {
    return jobs;
  }

  return [...pinned, ...unpinned];
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
