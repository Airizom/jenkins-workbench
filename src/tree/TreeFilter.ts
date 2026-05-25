import { isFailingJobColor, isRunningJobColor } from "../formatters/JobColorFormatters";
import type { JenkinsJobKind } from "../jenkins/JenkinsClient";
import type { JenkinsJobInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import { normalizeBranchFilter } from "./branchFilters";

interface TreeFilterOptions {
  parentFolderKind?: JenkinsJobKind;
  parentFolderUrl?: string;
}

export class JenkinsTreeFilter {
  constructor(private readonly viewStateStore: JenkinsViewStateStore) {}

  getBranchFilter(environmentId: string, folderUrl: string): string | undefined {
    return normalizeBranchFilter(this.viewStateStore.getBranchFilter(environmentId, folderUrl));
  }

  filterJobs(
    environment: JenkinsEnvironmentRef,
    jobs: JenkinsJobInfo[],
    options?: TreeFilterOptions,
    overrideKeys?: Set<string>
  ): JenkinsJobInfo[] {
    const jobFilterMode = this.viewStateStore.getJobFilterMode();
    const branchFilter =
      options?.parentFolderKind === "multibranch" && options.parentFolderUrl
        ? this.getBranchFilter(environment.environmentId, options.parentFolderUrl)
        : undefined;
    const branchNeedle = branchFilter?.toLowerCase() ?? "";
    const hasBranchFilter = branchNeedle.length > 0;
    let overrideUrlSet: Set<string> | undefined;
    if (overrideKeys && overrideKeys.size > 0) {
      const overrideKeyPrefix = `${environment.scope}:${environment.environmentId}:`;
      const prefixLen = overrideKeyPrefix.length;
      for (const key of overrideKeys) {
        if (key.startsWith(overrideKeyPrefix)) {
          if (!overrideUrlSet) {
            overrideUrlSet = new Set<string>();
          }
          overrideUrlSet.add(key.slice(prefixLen));
        }
      }
    }

    if (jobFilterMode === "all" && !hasBranchFilter) {
      return jobs;
    }

    return jobs.filter((job) => {
      if (job.kind === "folder" || job.kind === "multibranch") {
        return true;
      }

      if (overrideUrlSet?.has(job.url)) {
        return true;
      }

      if (jobFilterMode === "failing" && !isFailingJobColor(job.color)) {
        return false;
      }

      if (jobFilterMode === "running" && !isRunningJobColor(job.color)) {
        return false;
      }

      if (hasBranchFilter && !job.name.toLowerCase().includes(branchNeedle)) {
        return false;
      }

      return true;
    });
  }
}
