import type { JenkinsJobKind } from "../jenkins/JenkinsClient";
import type { JenkinsJobInfo } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsViewStateStore } from "../storage/JenkinsViewStateStore";
import { normalizeBranchFilter } from "./branchFilters";
import { buildOverrideKey } from "./TreeFilterKeys";

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

    return jobs.filter((job) => {
      if (job.kind === "folder" || job.kind === "multibranch") {
        return true;
      }

      if (this.isRevealOverride(environment, job.url, overrideKeys)) {
        return true;
      }

      if (jobFilterMode === "failing" && !this.isFailing(job.color)) {
        return false;
      }

      if (jobFilterMode === "running" && !this.isRunning(job.color)) {
        return false;
      }

      if (hasBranchFilter && !job.name.toLowerCase().includes(branchNeedle)) {
        return false;
      }

      return true;
    });
  }

  private isFailing(color?: string): boolean {
    if (!color) {
      return false;
    }
    const normalized = color.toLowerCase();
    const base = normalized.split("_")[0] ?? normalized;
    return base === "red";
  }

  private isRunning(color?: string): boolean {
    if (!color) {
      return false;
    }
    return color.toLowerCase().endsWith("_anime");
  }

  private isRevealOverride(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    overrideKeys?: Set<string>
  ): boolean {
    if (!overrideKeys || overrideKeys.size === 0) {
      return false;
    }
    return overrideKeys.has(buildOverrideKey(environment, jobUrl));
  }
}
