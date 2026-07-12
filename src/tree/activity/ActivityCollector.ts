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
  runningCandidates: JobSearchEntry[];
  collectionLimit: number;
  pendingInputCandidateLimit: number;
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

    const awaitingInputJobUrls = await this.awaitingInputEnricher.findAwaitingInputJobUrls(
      environment,
      scan.runningCandidates,
      {
        buildListFetchOptions: options.buildListFetchOptions,
        buildLookupLimit: collectionOptions.pendingInputBuildLookupLimit,
        bypassCache: options.bypassCache,
        lookupConcurrency: collectionOptions.pendingInputLookupConcurrency
      }
    );
    promoteAwaitingInputJobs(
      scan.groups,
      scan.runningCandidates,
      awaitingInputJobUrls,
      collectionLimit
    );

    return buildActivityViewModel(scan.groups, displayLimit);
  }
}

function createActivityScanState(
  collectionLimit: number,
  pendingInputCandidateLimit: number
): ActivityScanState {
  return {
    groups: createActivityGroups(),
    runningCandidates: [],
    collectionLimit,
    pendingInputCandidateLimit,
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

  if (classification.isRunning && scan.runningCandidates.length < scan.pendingInputCandidateLimit) {
    scan.runningCandidates.push(entry);
  }

  const groupItems = scan.groups.get(classification.group);
  if (groupItems && groupItems.length < scan.collectionLimit) {
    groupItems.push({ entry, group: classification.group });
  }

  if (hasCollectedEnough(scan)) {
    scan.stop = true;
  }
}

function hasCollectedEnough(scan: ActivityScanState): boolean {
  return (
    scan.runningCandidates.length >= scan.pendingInputCandidateLimit &&
    isGroupFull(scan, "failing") &&
    isGroupFull(scan, "unstable") &&
    isGroupFull(scan, "running")
  );
}

function isGroupFull(scan: ActivityScanState, group: "failing" | "unstable" | "running"): boolean {
  return (scan.groups.get(group)?.length ?? 0) >= scan.collectionLimit;
}
