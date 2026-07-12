import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  BuildListFetchOptions,
  JenkinsDataService,
  JobSearchEntry,
  PendingInputSummary
} from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { PendingInputRefreshCoordinator } from "../src/services/PendingInputRefreshCoordinator";
import {
  AwaitingInputEnricher,
  type AwaitingInputEnrichmentOptions
} from "../src/tree/activity/AwaitingInputEnricher";

interface FakeBuild {
  number: number;
  url?: string;
  building?: boolean;
}

const environment: JenkinsEnvironmentRef = {
  environmentId: "env-1",
  scope: "workspace",
  url: "https://jenkins.example/"
};

function createEntry(name: string): JobSearchEntry {
  return {
    name,
    url: `https://jenkins.example/job/${name}/`,
    color: "red_anime",
    kind: "job",
    fullName: name,
    path: []
  };
}

function createOptions(overrides: Partial<AwaitingInputEnrichmentOptions> = {}) {
  return {
    buildListFetchOptions: { detailLevel: "summary" } as BuildListFetchOptions,
    buildLookupLimit: 5,
    lookupConcurrency: 2,
    ...overrides
  } satisfies AwaitingInputEnrichmentOptions;
}

function createDataService(buildsByJobUrl: Map<string, FakeBuild[] | Error>): {
  dataService: JenkinsDataService;
  calls: Array<{ jobUrl: string; limit: number; options: BuildListFetchOptions }>;
} {
  const calls: Array<{ jobUrl: string; limit: number; options: BuildListFetchOptions }> = [];
  const dataService = {
    async getBuildsForJob(
      _environment: JenkinsEnvironmentRef,
      jobUrl: string,
      limit: number,
      options: BuildListFetchOptions
    ): Promise<FakeBuild[]> {
      calls.push({ jobUrl, limit, options });
      const builds = buildsByJobUrl.get(jobUrl) ?? [];
      if (builds instanceof Error) {
        throw builds;
      }
      return builds;
    }
  } as unknown as JenkinsDataService;
  return { dataService, calls };
}

function createCoordinator(summariesByBuildUrl: Map<string, PendingInputSummary> | Error): {
  coordinator: PendingInputRefreshCoordinator;
  calls: Array<{ buildUrls: string[]; options: unknown }>;
} {
  const calls: Array<{ buildUrls: string[]; options: unknown }> = [];
  const coordinator = {
    async getSummaries(
      _environment: JenkinsEnvironmentRef,
      buildUrls: string[],
      options?: unknown
    ): Promise<Map<string, PendingInputSummary>> {
      calls.push({ buildUrls, options });
      if (summariesByBuildUrl instanceof Error) {
        throw summariesByBuildUrl;
      }
      return summariesByBuildUrl;
    }
  } as unknown as PendingInputRefreshCoordinator;
  return { coordinator, calls };
}

function summary(awaitingInput: boolean): PendingInputSummary {
  return { awaitingInput, count: awaitingInput ? 1 : 0, fetchedAt: 1000 };
}

describe("AwaitingInputEnricher.findAwaitingInputJobUrls", () => {
  it("returns an empty set without lookups when there are no running candidates", async () => {
    const { dataService, calls } = createDataService(new Map());
    const { coordinator, calls: summaryCalls } = createCoordinator(new Map());
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(environment, [], createOptions());

    assert.deepEqual(result, new Set());
    assert.equal(calls.length, 0);
    assert.equal(summaryCalls.length, 0);
  });

  it("returns an empty set without summary lookups when no candidate has running builds", async () => {
    const job = createEntry("idle");
    const { dataService } = createDataService(
      new Map([
        [
          job.url,
          [
            { number: 3, url: `${job.url}3/`, building: false },
            { number: 2, building: true } // running build without a url is ignored
          ]
        ]
      ])
    );
    const { coordinator, calls: summaryCalls } = createCoordinator(new Map());
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(environment, [job], createOptions());

    assert.deepEqual(result, new Set());
    assert.equal(summaryCalls.length, 0);
  });

  it("forces bypassCache on build list lookups while keeping the other fetch options", async () => {
    const job = createEntry("deploy");
    const { dataService, calls } = createDataService(new Map([[job.url, []]]));
    const { coordinator } = createCoordinator(new Map());
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    await enricher.findAwaitingInputJobUrls(
      environment,
      [job],
      createOptions({ buildLookupLimit: 7 })
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].jobUrl, job.url);
    assert.equal(calls[0].limit, 7);
    assert.deepEqual(calls[0].options, { detailLevel: "summary", bypassCache: true });
  });

  it("marks jobs awaiting input when any running build has a pending input summary", async () => {
    const awaitingJob = createEntry("deploy");
    const busyJob = createEntry("build");
    const awaitingBuildUrl = `${awaitingJob.url}12/`;
    const busyBuildUrl = `${busyJob.url}4/`;
    const { dataService } = createDataService(
      new Map([
        [awaitingJob.url, [{ number: 12, url: awaitingBuildUrl, building: true }]],
        [busyJob.url, [{ number: 4, url: busyBuildUrl, building: true }]]
      ])
    );
    const { coordinator, calls: summaryCalls } = createCoordinator(
      new Map([
        [awaitingBuildUrl, summary(true)],
        [busyBuildUrl, summary(false)]
      ])
    );
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(
      environment,
      [awaitingJob, busyJob],
      createOptions()
    );

    assert.deepEqual(result, new Set([awaitingJob.url]));
    assert.equal(summaryCalls.length, 1);
    assert.deepEqual(summaryCalls[0].options, { queueRefresh: true });
  });

  it("skips builds with no summary entry when deciding awaiting input", async () => {
    const job = createEntry("deploy");
    const firstBuildUrl = `${job.url}1/`;
    const secondBuildUrl = `${job.url}2/`;
    const { dataService } = createDataService(
      new Map([
        [
          job.url,
          [
            { number: 1, url: firstBuildUrl, building: true },
            { number: 2, url: secondBuildUrl, building: true }
          ]
        ]
      ])
    );
    const { coordinator } = createCoordinator(new Map([[secondBuildUrl, summary(true)]]));
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(environment, [job], createOptions());

    assert.deepEqual(result, new Set([job.url]));
  });

  it("dedupes build urls before requesting summaries", async () => {
    const first = createEntry("first");
    const second = createEntry("second");
    const sharedBuildUrl = "https://jenkins.example/job/shared/9/";
    const { dataService } = createDataService(
      new Map([
        [first.url, [{ number: 9, url: sharedBuildUrl, building: true }]],
        [second.url, [{ number: 9, url: sharedBuildUrl, building: true }]]
      ])
    );
    const { coordinator, calls: summaryCalls } = createCoordinator(
      new Map([[sharedBuildUrl, summary(true)]])
    );
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(
      environment,
      [first, second],
      createOptions()
    );

    assert.deepEqual(summaryCalls[0].buildUrls, [sharedBuildUrl]);
    assert.deepEqual(result, new Set([first.url, second.url]));
  });

  it("still enriches other jobs when one build list lookup fails", async () => {
    const broken = createEntry("broken");
    const healthy = createEntry("healthy");
    const healthyBuildUrl = `${healthy.url}2/`;
    const { dataService } = createDataService(
      new Map<string, FakeBuild[] | Error>([
        [broken.url, new Error("boom")],
        [healthy.url, [{ number: 2, url: healthyBuildUrl, building: true }]]
      ])
    );
    const { coordinator } = createCoordinator(new Map([[healthyBuildUrl, summary(true)]]));
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(
      environment,
      [broken, healthy],
      createOptions()
    );

    assert.deepEqual(result, new Set([healthy.url]));
  });

  it("returns an empty set when the summary lookup fails", async () => {
    const job = createEntry("deploy");
    const { dataService } = createDataService(
      new Map([[job.url, [{ number: 1, url: `${job.url}1/`, building: true }]]])
    );
    const { coordinator } = createCoordinator(new Error("summaries unavailable"));
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(environment, [job], createOptions());

    assert.deepEqual(result, new Set());
  });

  it("processes every candidate even when concurrency is below one", async () => {
    const first = createEntry("first");
    const second = createEntry("second");
    const firstBuildUrl = `${first.url}1/`;
    const secondBuildUrl = `${second.url}1/`;
    const { dataService, calls } = createDataService(
      new Map([
        [first.url, [{ number: 1, url: firstBuildUrl, building: true }]],
        [second.url, [{ number: 1, url: secondBuildUrl, building: true }]]
      ])
    );
    const { coordinator } = createCoordinator(
      new Map([
        [firstBuildUrl, summary(true)],
        [secondBuildUrl, summary(true)]
      ])
    );
    const enricher = new AwaitingInputEnricher(dataService, coordinator);

    const result = await enricher.findAwaitingInputJobUrls(
      environment,
      [first, second],
      createOptions({ lookupConcurrency: 0 })
    );

    assert.equal(calls.length, 2);
    assert.deepEqual(result, new Set([first.url, second.url]));
  });
});
