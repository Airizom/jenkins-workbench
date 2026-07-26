import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsDataService, JobSearchEntry } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../src/services/PendingInputRefreshCoordinator";
import type { TreeActivityOptions } from "../src/tree/ActivityTypes";
import { ActivityClassifier } from "../src/tree/activity/ActivityClassifier";
import {
  ActivityCollector,
  type ActivityCollectorOptions
} from "../src/tree/activity/ActivityCollector";
import type {
  AwaitingInputEnricher,
  AwaitingInputEnrichmentOptions
} from "../src/tree/activity/AwaitingInputEnricher";

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

const coordinatorStub = {} as unknown as PendingInputRefreshCoordinator;

interface IterateOptionsSnapshot {
  mode?: string;
  maxResults?: number;
  batchSize?: number;
}

function createEntry(name: string, color?: string): JobSearchEntry {
  return {
    name,
    url: `https://jenkins.example/job/${name}/`,
    color,
    kind: "job",
    fullName: name,
    path: []
  };
}

function createDataService(batches: JobSearchEntry[][]): {
  dataService: JenkinsDataService;
  yieldedBatchIndexes: number[];
  iterateOptions: IterateOptionsSnapshot[];
} {
  const yieldedBatchIndexes: number[] = [];
  const iterateOptions: IterateOptionsSnapshot[] = [];
  const dataService = {
    async *iterateJobsForEnvironment(
      _environment: JenkinsEnvironmentRef,
      options: IterateOptionsSnapshot & {
        cancellation?: { isCancellationRequested: boolean };
      }
    ): AsyncGenerator<JobSearchEntry[]> {
      iterateOptions.push({
        mode: options.mode,
        maxResults: options.maxResults,
        batchSize: options.batchSize
      });
      for (const [index, batch] of batches.entries()) {
        if (options.cancellation?.isCancellationRequested) {
          return;
        }
        yieldedBatchIndexes.push(index);
        yield batch;
      }
    }
  } as unknown as JenkinsDataService;
  return { dataService, yieldedBatchIndexes, iterateOptions };
}

function createEnricher(awaitingInputJobUrls: Set<string>): {
  enricher: AwaitingInputEnricher;
  calls: Array<{ runningCandidates: JobSearchEntry[]; options: AwaitingInputEnrichmentOptions }>;
} {
  const calls: Array<{
    runningCandidates: JobSearchEntry[];
    options: AwaitingInputEnrichmentOptions;
  }> = [];
  const enricher = {
    async findAwaitingInputJobUrls(
      _environment: JenkinsEnvironmentRef,
      runningCandidates: JobSearchEntry[],
      options: AwaitingInputEnrichmentOptions
    ): Promise<Set<string>> {
      calls.push({ runningCandidates: [...runningCandidates], options });
      return awaitingInputJobUrls;
    }
  } as unknown as AwaitingInputEnricher;
  return { enricher, calls };
}

function createCollectorOptions(
  overrides: Partial<TreeActivityOptions> & { bypassCache?: boolean } = {}
): ActivityCollectorOptions {
  const { bypassCache, ...activityOverrides } = overrides;
  return {
    activityOptions: {
      maxItemsPerGroup: 2,
      collection: {
        maxScanResults: 100,
        jobSearchBatchSize: 10,
        pendingInputCandidateLimit: 4,
        pendingInputLookupConcurrency: 2,
        pendingInputBuildLookupLimit: 5,
        refreshMinIntervalMs: 0
      },
      ...activityOverrides
    },
    buildListFetchOptions: { detailLevel: "summary" },
    bypassCache
  };
}

function createCollector(
  batches: JobSearchEntry[][],
  awaitingInputJobUrls: Set<string> = new Set()
) {
  const { dataService, yieldedBatchIndexes, iterateOptions } = createDataService(batches);
  const { enricher, calls: enricherCalls } = createEnricher(awaitingInputJobUrls);
  const collector = new ActivityCollector(
    dataService,
    coordinatorStub,
    new ActivityClassifier(),
    enricher
  );
  return { collector, yieldedBatchIndexes, iterateOptions, enricherCalls };
}

function groupNames(viewModel: {
  groups: ReadonlyArray<{ kind: string; items: ReadonlyArray<{ name: string }> }>;
}): Array<{ kind: string; names: string[] }> {
  return viewModel.groups.map((group) => ({
    kind: group.kind,
    names: group.items.map((item) => item.name)
  }));
}

describe("ActivityCollector.collect", () => {
  it("groups classified jobs and skips entries without an activity classification", async () => {
    const { collector } = createCollector([
      [
        createEntry("broken", "red"),
        createEntry("flaky", "yellow"),
        createEntry("building", "blue_anime"),
        createEntry("healthy", "blue"),
        createEntry("colorless")
      ]
    ]);

    const viewModel = await collector.collect(environment, createCollectorOptions());

    assert.deepEqual(groupNames(viewModel), [
      { kind: "failing", names: ["broken"] },
      { kind: "unstable", names: ["flaky"] },
      { kind: "running", names: ["building"] }
    ]);
    assert.equal(viewModel.summary.displayedTotal, 3);
    assert.equal(viewModel.summary.isTruncated, false);
  });

  it("passes scan options through and requests a refresh when bypassing the cache", async () => {
    const batches = [[createEntry("broken", "red")]];
    const first = createCollector(batches);
    await first.collector.collect(environment, createCollectorOptions());

    const second = createCollector(batches);
    await second.collector.collect(environment, createCollectorOptions({ bypassCache: true }));

    assert.deepEqual(first.iterateOptions, [{ mode: undefined, maxResults: 100, batchSize: 10 }]);
    assert.deepEqual(second.iterateOptions, [{ mode: "refresh", maxResults: 100, batchSize: 10 }]);
  });

  it("collects one extra entry per group so truncation is detectable", async () => {
    const { collector } = createCollector([
      [
        createEntry("broken-1", "red"),
        createEntry("broken-2", "red"),
        createEntry("broken-3", "red"),
        createEntry("broken-4", "red")
      ]
    ]);

    const viewModel = await collector.collect(
      environment,
      createCollectorOptions({ maxItemsPerGroup: 2 })
    );

    const failing = viewModel.groups.find((group) => group.kind === "failing");
    assert.deepEqual(
      failing?.items.map((item) => item.name),
      ["broken-1", "broken-2"]
    );
    assert.equal(failing?.isTruncated, true);
    assert.equal(viewModel.summary.isTruncated, true);
  });

  it("stops scanning once every group and the candidate list are full", async () => {
    const fullBatch = [
      createEntry("failing-1", "red"),
      createEntry("failing-2", "red"),
      createEntry("unstable-1", "yellow"),
      createEntry("unstable-2", "yellow"),
      createEntry("running-1", "red_anime"),
      createEntry("running-2", "blue_anime"),
      createEntry("failing-late", "red")
    ];
    const { collector, yieldedBatchIndexes } = createCollector([
      fullBatch,
      [createEntry("never-seen", "red")]
    ]);

    const viewModel = await collector.collect(
      environment,
      createCollectorOptions({
        maxItemsPerGroup: 1,
        collection: {
          maxScanResults: 100,
          jobSearchBatchSize: 10,
          pendingInputCandidateLimit: 2,
          pendingInputLookupConcurrency: 2,
          pendingInputBuildLookupLimit: 5,
          refreshMinIntervalMs: 0
        }
      })
    );

    assert.deepEqual(yieldedBatchIndexes, [0]);
    const names = viewModel.groups.flatMap((group) => group.items.map((item) => item.name));
    assert.ok(!names.includes("failing-late"));
    assert.ok(!names.includes("never-seen"));
  });

  it("caps running candidates handed to the awaiting-input enricher", async () => {
    const { collector, enricherCalls } = createCollector([
      [
        createEntry("running-1", "red_anime"),
        createEntry("running-2", "blue_anime"),
        createEntry("running-3", "blue_anime")
      ]
    ]);

    await collector.collect(
      environment,
      createCollectorOptions({
        collection: {
          maxScanResults: 100,
          jobSearchBatchSize: 10,
          pendingInputCandidateLimit: 2,
          pendingInputLookupConcurrency: 3,
          pendingInputBuildLookupLimit: 7,
          refreshMinIntervalMs: 0
        },
        bypassCache: true
      })
    );

    assert.equal(enricherCalls.length, 1);
    assert.deepEqual(
      enricherCalls[0].runningCandidates.map((entry) => entry.name),
      ["running-1", "running-2"]
    );
    assert.deepEqual(enricherCalls[0].options, {
      buildListFetchOptions: { detailLevel: "summary" },
      buildLookupLimit: 7,
      lookupConcurrency: 3
    });
  });

  it("promotes awaiting-input jobs out of the running group", async () => {
    const awaiting = createEntry("deploy", "red_anime");
    const running = createEntry("build", "blue_anime");
    const { collector } = createCollector([[awaiting, running]], new Set([awaiting.url]));

    const viewModel = await collector.collect(environment, createCollectorOptions());

    assert.deepEqual(groupNames(viewModel), [
      { kind: "awaitingInput", names: ["deploy"] },
      { kind: "running", names: ["build"] }
    ]);
  });
});
