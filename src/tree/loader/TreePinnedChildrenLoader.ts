import { JenkinsActionError, JenkinsRequestError } from "../../jenkins/errors";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { decodeJenkinsJobName } from "../../jenkins/JenkinsJobNames";
import type { JenkinsPinStore } from "../../storage/JenkinsPinStore";
import type { ScopedJobStoreEntry } from "../../storage/ScopedJobStore";
import { JobTreeItem, StalePinnedJobTreeItem } from "../items/TreeJobItems";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { ROOT_TREE_JOB_SCOPE } from "../TreeJobScope";
import { PINNED_ITEM_LOOKUP_CONCURRENCY } from "./TreeChildrenConfig";
import { getCanonicalPinnedJobUrl, type TreeJobUrlStateLoader } from "./TreeJobUrlStateLoader";
import type { TreePlaceholderFactory } from "./TreePlaceholderFactory";

export class TreePinnedChildrenLoader {
  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly pinStore: JenkinsPinStore,
    private readonly jobUrlState: TreeJobUrlStateLoader,
    private readonly placeholders: TreePlaceholderFactory
  ) {}

  async loadPinnedItemsForEnvironment(
    environment: JenkinsEnvironmentRef
  ): Promise<WorkbenchTreeElement[]> {
    try {
      const [pinnedEntries, watchedJobs] = await Promise.all([
        this.pinStore.listPinnedJobsForEnvironment(environment.scope, environment.environmentId),
        this.jobUrlState.getWatchedJobUrls(environment).catch(() => new Set<string>())
      ]);
      const pinnedJobs = this.jobUrlState.getPinnedJobUrlsFromEntries(environment, pinnedEntries);

      if (pinnedEntries.length === 0) {
        return [
          this.placeholders.createEmptyPlaceholder(
            "No pinned jobs or pipelines.",
            "Pin a job or pipeline to keep it here for quick access."
          )
        ];
      }

      return await this.loadPinnedItems(environment, pinnedEntries, watchedJobs, pinnedJobs);
    } catch (error) {
      return [this.placeholders.createErrorPlaceholder("Unable to load pinned jobs.", error)];
    }
  }

  private async loadPinnedItem(
    environment: JenkinsEnvironmentRef,
    entry: ScopedJobStoreEntry,
    watchedJobs: Set<string>,
    pinnedJobs: Set<string>
  ): Promise<WorkbenchTreeElement> {
    const canonicalJobUrl = getCanonicalPinnedJobUrl(environment, entry.jobUrl);

    try {
      const current = await this.dataService.getJobInfo(environment, canonicalJobUrl);
      if (current.kind !== "job" && current.kind !== "pipeline") {
        return this.createStalePinnedItem(environment, entry);
      }

      await this.updatePinnedEntryUrlIfNeeded(environment, entry, canonicalJobUrl);

      const isWatched = watchedJobs.has(canonicalJobUrl);
      const isPinned = pinnedJobs.has(canonicalJobUrl);
      return new JobTreeItem({
        presentation: current.kind,
        variant: "quickAccess",
        environment,
        label: decodeJenkinsJobName(current.name),
        jobUrl: canonicalJobUrl,
        jobScope: ROOT_TREE_JOB_SCOPE,
        color: current.color,
        isWatched,
        isPinned
      });
    } catch (error) {
      if (this.isMissingPinnedItemError(error)) {
        return this.createStalePinnedItem(environment, entry);
      }

      return this.placeholders.createErrorPlaceholder(
        `Unable to load ${entry.jobName ?? entry.jobUrl}`,
        error
      );
    }
  }

  private createStalePinnedItem(
    environment: JenkinsEnvironmentRef,
    entry: ScopedJobStoreEntry
  ): StalePinnedJobTreeItem {
    return new StalePinnedJobTreeItem(
      environment,
      entry.jobName ?? entry.jobUrl,
      entry.jobUrl,
      entry.jobKind ?? "job"
    );
  }

  private isMissingPinnedItemError(error: unknown): boolean {
    if (error instanceof JenkinsActionError) {
      return error.code === "not_found";
    }

    return error instanceof JenkinsRequestError && error.statusCode === 404;
  }

  private async loadPinnedItems(
    environment: JenkinsEnvironmentRef,
    pinnedEntries: ScopedJobStoreEntry[],
    watchedJobs: Set<string>,
    pinnedJobs: Set<string>
  ): Promise<WorkbenchTreeElement[]> {
    const items: WorkbenchTreeElement[] = [];

    for (let index = 0; index < pinnedEntries.length; index += PINNED_ITEM_LOOKUP_CONCURRENCY) {
      const limit = Math.min(index + PINNED_ITEM_LOOKUP_CONCURRENCY, pinnedEntries.length);
      const pending: Promise<WorkbenchTreeElement>[] = [];
      for (let batchIndex = index; batchIndex < limit; batchIndex++) {
        pending.push(
          this.loadPinnedItem(environment, pinnedEntries[batchIndex], watchedJobs, pinnedJobs)
        );
      }
      const loaded = await Promise.all(pending);
      items.push(...loaded);
    }

    return items;
  }

  private async updatePinnedEntryUrlIfNeeded(
    environment: JenkinsEnvironmentRef,
    entry: ScopedJobStoreEntry,
    canonicalJobUrl: string
  ): Promise<void> {
    if (canonicalJobUrl === entry.jobUrl) {
      return;
    }

    try {
      await this.pinStore.updatePinUrl(
        environment.scope,
        environment.environmentId,
        entry.jobUrl,
        canonicalJobUrl,
        entry.jobName
      );
    } catch {
      // Keep rendering the pinned item even if persisting the canonical URL fails.
    }
  }
}
