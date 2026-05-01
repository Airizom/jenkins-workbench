import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { JenkinsActionError, JenkinsRequestError } from "../../jenkins/errors";
import type { JenkinsPinStore, StoredPinnedJobEntry } from "../../storage/JenkinsPinStore";
import { ROOT_TREE_JOB_SCOPE } from "../TreeJobScope";
import {
  QuickAccessJobTreeItem,
  QuickAccessPipelineTreeItem,
  StalePinnedJobTreeItem
} from "../items/TreeJobItems";
import type { PlaceholderTreeItem } from "../items/TreePlaceholderItem";
import type { WorkbenchTreeElement } from "../items/WorkbenchTreeElement";
import { PINNED_ITEM_LOOKUP_CONCURRENCY } from "./TreeChildrenConfig";
import { type TreeJobUrlStateLoader, getCanonicalPinnedJobUrl } from "./TreeJobUrlStateLoader";
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
      const [pinnedEntries, watchedJobs, pinnedJobs] = await Promise.all([
        this.pinStore.listPinnedJobsForEnvironment(environment.scope, environment.environmentId),
        this.jobUrlState.getWatchedJobUrls(environment),
        this.jobUrlState.getPinnedJobUrls(environment)
      ]);

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
    entry: StoredPinnedJobEntry,
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

      return current.kind === "pipeline"
        ? new QuickAccessPipelineTreeItem(
            environment,
            current.name,
            canonicalJobUrl,
            ROOT_TREE_JOB_SCOPE,
            current.color,
            isWatched,
            isPinned
          )
        : new QuickAccessJobTreeItem(
            environment,
            current.name,
            canonicalJobUrl,
            ROOT_TREE_JOB_SCOPE,
            current.color,
            isWatched,
            isPinned
          );
    } catch (error) {
      if (this.isMissingPinnedItemError(error)) {
        return this.createStalePinnedItem(environment, entry);
      }

      return this.createPinnedItemErrorPlaceholder(entry, error);
    }
  }

  private createStalePinnedItem(
    environment: JenkinsEnvironmentRef,
    entry: StoredPinnedJobEntry
  ): StalePinnedJobTreeItem {
    return new StalePinnedJobTreeItem(
      environment,
      entry.jobName ?? entry.jobUrl,
      entry.jobUrl,
      entry.jobKind ?? "job"
    );
  }

  private createPinnedItemErrorPlaceholder(
    entry: StoredPinnedJobEntry,
    error: unknown
  ): PlaceholderTreeItem {
    const label = `Unable to load ${entry.jobName ?? entry.jobUrl}`;
    return this.placeholders.createErrorPlaceholder(label, error);
  }

  private isMissingPinnedItemError(error: unknown): boolean {
    if (error instanceof JenkinsActionError) {
      return error.code === "not_found";
    }

    return error instanceof JenkinsRequestError && error.statusCode === 404;
  }

  private async loadPinnedItems(
    environment: JenkinsEnvironmentRef,
    pinnedEntries: StoredPinnedJobEntry[],
    watchedJobs: Set<string>,
    pinnedJobs: Set<string>
  ): Promise<WorkbenchTreeElement[]> {
    const items: WorkbenchTreeElement[] = [];

    for (let index = 0; index < pinnedEntries.length; index += PINNED_ITEM_LOOKUP_CONCURRENCY) {
      const batch = pinnedEntries.slice(index, index + PINNED_ITEM_LOOKUP_CONCURRENCY);
      const loaded = await Promise.all(
        batch.map((entry) => this.loadPinnedItem(environment, entry, watchedJobs, pinnedJobs))
      );
      items.push(...loaded);
    }

    return items;
  }

  private async updatePinnedEntryUrlIfNeeded(
    environment: JenkinsEnvironmentRef,
    entry: StoredPinnedJobEntry,
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
