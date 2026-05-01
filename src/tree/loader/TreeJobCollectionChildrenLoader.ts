import type { JenkinsJobKind } from "../../jenkins/JenkinsClient";
import type { JenkinsDataService, JenkinsJobInfo } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { EnvironmentSummaryStore } from "../EnvironmentSummaryStore";
import type { JenkinsTreeFilter } from "../TreeFilter";
import type { TreeJobCollectionRequest } from "../TreeJobScope";
import type { TreeChildrenOptions } from "../TreeTypes";
import { JenkinsFolderTreeItem } from "../items/TreeJobItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import type { TreeChildrenCacheManager } from "./TreeChildrenCacheManager";
import {
  buildJobCollectionChildrenKey,
  getJobCollectionElement,
  getJobCollectionLoadingLabel,
  getJobCollectionRequest,
  mapJobsToTreeItems,
  toJenkinsJobCollectionRequest
} from "./TreeChildrenMapping";
import type { TreeJobUrlStateLoader } from "./TreeJobUrlStateLoader";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreeJobCollectionChildrenLoader {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly treeFilter: JenkinsTreeFilter,
    private readonly environmentSummaryStore: EnvironmentSummaryStore,
    private readonly cacheManager: TreeChildrenCacheManager,
    private readonly jobUrlState: TreeJobUrlStateLoader,
    private readonly buildChildrenKey: (
      kind: string,
      environment: JenkinsEnvironmentRef,
      extra?: string
    ) => string,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async getJobCollectionChildren(
    element: WorkbenchTreeElement,
    options?: TreeChildrenOptions
  ): Promise<WorkbenchTreeElement[]> {
    const jobCollectionElement = getJobCollectionElement(element);
    if (!jobCollectionElement) {
      return [];
    }

    const request = getJobCollectionRequest(jobCollectionElement);
    const parentFolderKind =
      jobCollectionElement instanceof JenkinsFolderTreeItem
        ? jobCollectionElement.folderKind
        : undefined;
    if (options?.overrideKeys && options.overrideKeys.size > 0) {
      return await this.loadJobsForCollection(jobCollectionElement.environment, request, {
        parentFolderKind,
        overrideKeys: options.overrideKeys
      });
    }
    return await this.cacheManager.getOrLoadChildren(
      this.buildJobCollectionChildrenKey(jobCollectionElement.environment, request),
      jobCollectionElement,
      () =>
        this.loadJobsForCollection(jobCollectionElement.environment, request, {
          parentFolderKind,
          overrideKeys: options?.overrideKeys
        }),
      getJobCollectionLoadingLabel(request)
    );
  }

  invalidateJobCollectionChildren(element: WorkbenchTreeElement): void {
    const jobCollectionElement = getJobCollectionElement(element);
    if (!jobCollectionElement) {
      return;
    }

    this.cacheManager.clearChildrenCache(
      this.buildJobCollectionChildrenKey(
        jobCollectionElement.environment,
        getJobCollectionRequest(jobCollectionElement)
      )
    );
  }

  private async loadJobsForCollection(
    environment: JenkinsEnvironmentRef,
    request: TreeJobCollectionRequest,
    options?: {
      parentFolderKind?: JenkinsJobKind;
      overrideKeys?: Set<string>;
    }
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const jobs = await this.dataService.getJobCollection(
        environment,
        toJenkinsJobCollectionRequest(request)
      );
      if (!request.folderUrl && request.scope.kind === "root") {
        this.environmentSummaryStore.updateFromJobs(environment, jobs);
      }
      return await this.mapJobsToTreeItems(environment, jobs, {
        parentFolderKind: options?.parentFolderKind,
        parentFolderUrl: request.folderUrl,
        overrideKeys: options?.overrideKeys,
        jobScope: request.scope
      });
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load jobs.", error)];
    }
  }

  private async mapJobsToTreeItems(
    environment: JenkinsEnvironmentRef,
    jobs: JenkinsJobInfo[],
    options?: {
      parentFolderKind?: JenkinsJobKind;
      parentFolderUrl?: string;
      overrideKeys?: Set<string>;
      jobScope?: TreeJobCollectionRequest["scope"];
    }
  ): Promise<WorkbenchTreeElement[]> {
    const [watchedJobs, pinnedJobs] = await Promise.all([
      this.jobUrlState.getWatchedJobUrls(environment),
      this.jobUrlState.getPinnedJobUrls(environment)
    ]);
    return mapJobsToTreeItems(
      environment,
      jobs,
      this.treeFilter,
      options ?? {},
      watchedJobs,
      pinnedJobs,
      (label, description) => this.placeholders.createEmptyPlaceholder(label, description)
    );
  }

  private buildJobCollectionChildrenKey(
    environment: JenkinsEnvironmentRef,
    request: TreeJobCollectionRequest
  ): string {
    return buildJobCollectionChildrenKey(this.buildChildrenKey, environment, request);
  }
}
