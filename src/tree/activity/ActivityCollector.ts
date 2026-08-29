import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JobSearchEntry
} from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import type { ActivityViewModel, TreeActivityOptions } from "../ActivityTypes";
import { ActivityClassifier } from "./ActivityClassifier";
import type { ActivityGroups } from "./ActivityCollectionModel";
import { createActivityGroups, promoteAwaitingInputJobs } from "./ActivityCollectionPolicy";
import { buildActivityViewModel } from "./ActivityViewModelBuilder";
import { AwaitingInputEnricher } from "./AwaitingInputEnricher";

export interface ActivityCollectorOptions {
  activityOptions: TreeActivityOptions;
  buildListFetchOptions: BuildListFetchOptions;
  bypassCache?: boolean;
}

interface ActivityScanState {
  groups: ActivityGroups;
  collectionLimit: number;
  runningCollectionLimit: number;
  stop: boolean;
}

export class ActivityCollector {
  constructor(
    private readonly dataService: JenkinsDataService,
    pendingInputCoordinator: PendingInputRefreshCoordinator,
    private readonly classifier = new ActivityClassifier(),
    private readonly awaitingInputEnricher = new AwaitingInputEnricher(
      dataService,
      pendingInputCoordinator
    )
  ) {}

  async collect(
    environment: JenkinsEnvironmentRef,
    options: ActivityCollectorOptions
  ): Promise<ActivityViewModel> {
    const displayLimit = options.activityOptions.maxItemsPerGroup;
    const collectionLimit = displayLimit + 1;
    const collectionOptions = options.activityOptions.collection;
    const scan = createActivityScanState(
      collectionLimit,
      collectionOptions.pendingInputCandidateLimit
    );
    const cancellation = {
      get isCancellationRequested(): boolean {
        return scan.stop;
      }
    };

    for await (const batch of this.dataService.iterateJobsForEnvironment(environment, {
      cancellation,
      mode: options.bypassCache ? "refresh" : undefined,
      maxResults: collectionOptions.maxScanResults,
      batchSize: collectionOptions.jobSearchBatchSize
    })) {
      collectBatchEntries(scan, batch, this.classifier);
      if (scan.stop) {
        break;
      }
    }

    const runningEntries = scan.groups.get("running") ?? [];
    const awaitingInputJobUrls = await this.awaitingInputEnricher.findAwaitingInputJobUrls(
      environment,
      runningEntries.slice(0, collectionOptions.pendingInputCandidateLimit),
      {
        buildListFetchOptions: options.buildListFetchOptions,
        buildLookupLimit: collectionOptions.pendingInputBuildLookupLimit,
        lookupConcurrency: collectionOptions.pendingInputLookupConcurrency
      }
    );
    promoteAwaitingInputJobs(scan.groups, runningEntries, awaitingInputJobUrls, collectionLimit);

    return buildActivityViewModel(scan.groups, displayLimit);
  }
}

function createActivityScanState(
  collectionLimit: number,
  pendingInputCandidateLimit: number
): ActivityScanState {
  return {
    groups: createActivityGroups(),
    collectionLimit,
    // Retain every enrichment candidate and enough entries to refill Running after promotion.
    runningCollectionLimit: Math.max(
      pendingInputCandidateLimit,
      collectionLimit + Math.min(collectionLimit, pendingInputCandidateLimit)
    ),
    stop: false
  };
}

function collectBatchEntries(
  scan: ActivityScanState,
  batch: JobSearchEntry[],
  classifier: ActivityClassifier
): void {
  for (const entry of batch) {
    collectEntry(scan, entry, classifier);
    if (scan.stop) {
      return;
    }
  }
}

function collectEntry(
  scan: ActivityScanState,
  entry: JobSearchEntry,
  classifier: ActivityClassifier
): void {
  const classification = classifier.classify(entry);
  if (!classification) {
    return;
  }

  const groupItems = scan.groups.get(classification.group);
  const groupCollectionLimit =
    classification.group === "running" ? scan.runningCollectionLimit : scan.collectionLimit;
  if (groupItems && groupItems.length < groupCollectionLimit) {
    groupItems.push(entry);
  }

  if (hasCollectedEnough(scan)) {
    scan.stop = true;
  }
}

function hasCollectedEnough(scan: ActivityScanState): boolean {
  return (
    isGroupFull(scan, "failing", scan.collectionLimit) &&
    isGroupFull(scan, "unstable", scan.collectionLimit) &&
    isGroupFull(scan, "running", scan.runningCollectionLimit)
  );
}

function isGroupFull(
  scan: ActivityScanState,
  group: "failing" | "unstable" | "running",
  limit: number
): boolean {
  return (scan.groups.get(group)?.length ?? 0) >= limit;
}
