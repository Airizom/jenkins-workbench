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
    options?: TreeFilterOptions
  ): JenkinsJobInfo[] {
    const jobFilterMode = this.viewStateStore.getJobFilterMode();
    const branchFilter =
      options?.parentFolderKind === "multibranch" && options.parentFolderUrl
        ? this.getBranchFilter(environment.environmentId, options.parentFolderUrl)
        : undefined;
    const branchNeedle = branchFilter?.toLowerCase() ?? "";
    const hasBranchFilter = branchNeedle.length > 0;

    if (jobFilterMode === "all" && !hasBranchFilter) {
      return jobs;
    }

    return jobs.filter((job) => {
      if (job.kind === "folder" || job.kind === "multibranch") {
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
