import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JobSearchEntry
} from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../../services/PendingInputRefreshCoordinator";
import type { ActivityViewModel, TreeActivityOptions } from "../ActivityTypes";
import { ActivityClassifier } from "./ActivityClassifier";
import {
  areActivityCollectionTargetsFull,
  createActivityGroups,
  promoteAwaitingInputJobs
} from "./ActivityCollectionPolicy";
import { buildActivityViewModel } from "./ActivityViewModelBuilder";
import { AwaitingInputEnricher } from "./AwaitingInputEnricher";

export interface ActivityCollectorOptions {
  activityOptions: TreeActivityOptions;
  buildListFetchOptions: BuildListFetchOptions;
  bypassCache?: boolean;
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
    const pendingInputCandidateLimit = collectionOptions.pendingInputCandidateLimit;
    const groups = createActivityGroups();
    const runningCandidates: JobSearchEntry[] = [];
    let stop = false;
    const cancellation = {
      get isCancellationRequested(): boolean {
        return stop;
      }
    };

    for await (const batch of this.dataService.iterateJobsForEnvironment(environment, {
      cancellation,
      mode: options.bypassCache ? "refresh" : undefined,
      maxResults: collectionOptions.maxScanResults,
      batchSize: collectionOptions.jobSearchBatchSize
    })) {
      for (const entry of batch) {
        const classification = this.classifier.classify(entry);
        if (!classification) {
          continue;
        }

        if (classification.isRunning && runningCandidates.length < pendingInputCandidateLimit) {
          runningCandidates.push(entry);
        }

        const groupItems = groups.get(classification.group);
        if (groupItems && groupItems.length < collectionLimit) {
          groupItems.push({ entry, group: classification.group });
        }

        if (
          areActivityCollectionTargetsFull(
            groups,
            runningCandidates.length,
            collectionLimit,
            pendingInputCandidateLimit
          )
        ) {
          stop = true;
          break;
        }
      }
      if (stop) {
        break;
      }
    }

    const awaitingInputJobUrls = await this.awaitingInputEnricher.findAwaitingInputJobUrls(
      environment,
      runningCandidates,
      {
        buildListFetchOptions: options.buildListFetchOptions,
        buildLookupLimit: collectionOptions.pendingInputBuildLookupLimit,
        bypassCache: options.bypassCache,
        lookupConcurrency: collectionOptions.pendingInputLookupConcurrency
      }
    );
    promoteAwaitingInputJobs(groups, runningCandidates, awaitingInputJobUrls, collectionLimit);

    return buildActivityViewModel(groups, displayLimit);
  }
}
