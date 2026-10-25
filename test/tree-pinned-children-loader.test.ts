import assert from "node:assert/strict";
import { it } from "vitest";
import type { JenkinsDataService } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { JenkinsPinStore } from "../src/storage/JenkinsPinStore";
import { JobTreeItem } from "../src/tree/items/TreeJobItems";
import { TreePinnedChildrenLoader } from "../src/tree/loader/TreePinnedChildrenLoader";
import type { TreeJobUrlStateLoader } from "../src/tree/loader/TreeJobUrlStateLoader";

it("renders pinned jobs when watched job lookup fails", async () => {
  const environment: JenkinsEnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };
  const jobUrl = "https://jenkins.example/job/demo/";
  const loader = new TreePinnedChildrenLoader(
    {
      getJobInfo: async () => ({ kind: "job", name: "demo", color: "blue" })
    } as unknown as JenkinsDataService,
    {
      listPinnedJobsForEnvironment: async () => [{ environmentId: "env-1", jobUrl }]
    } as unknown as JenkinsPinStore,
    {
      getWatchedJobUrls: async () => {
        throw new Error("watch store unavailable");
      },
      getPinnedJobUrlsFromEntries: (
        _environment: JenkinsEnvironmentRef,
        entries: { jobUrl: string }[]
      ) => new Set(entries.map((entry) => entry.jobUrl))
    } as unknown as TreeJobUrlStateLoader,
    {
      createEmptyPlaceholder: () => {
        throw new Error("unexpected empty placeholder");
      },
      createErrorPlaceholder: () => {
        throw new Error("unexpected error placeholder");
      }
    }
  );

  const items = await loader.loadPinnedItemsForEnvironment(environment);

  assert.equal(items.length, 1);
  assert.ok(items[0] instanceof JobTreeItem);
  assert.equal(items[0].jobUrl, jobUrl);
  assert.equal(items[0].isPinned, true);
  assert.equal(items[0].isWatched, false);
});

it("starts later pinned lookups while an earlier lookup is slow and keeps pin order", async () => {
  const environment: JenkinsEnvironmentRef = {
    environmentId: "env-1",
    scope: "workspace",
    url: "https://jenkins.example/"
  };
  const names = ["a", "b", "c", "d", "e", "f"];
  const entries = names.map((name) => ({
    environmentId: "env-1",
    jobUrl: `https://jenkins.example/job/${name}/`
  }));
  const started: string[] = [];
  let releaseFirst: () => void = () => {};
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markLastStarted: () => void = () => {};
  const lastStarted = new Promise<void>((resolve) => {
    markLastStarted = resolve;
  });

  const loader = new TreePinnedChildrenLoader(
    {
      getJobInfo: async (_environment: JenkinsEnvironmentRef, jobUrl: string) => {
        const name = names.find((candidate) => jobUrl.endsWith(`/job/${candidate}/`)) ?? "";
        started.push(name);
        if (started.length === names.length) {
          markLastStarted();
        }
        if (name === "a") {
          await firstGate;
        }
        return { kind: "job", name, color: "blue" };
      }
    } as unknown as JenkinsDataService,
    {
      listPinnedJobsForEnvironment: async () => entries
    } as unknown as JenkinsPinStore,
    {
      getWatchedJobUrls: async () => new Set<string>(),
      getPinnedJobUrlsFromEntries: (
        _environment: JenkinsEnvironmentRef,
        pinned: { jobUrl: string }[]
      ) => new Set(pinned.map((entry) => entry.jobUrl))
    } as unknown as TreeJobUrlStateLoader,
    {
      createEmptyPlaceholder: () => {
        throw new Error("unexpected empty placeholder");
      },
      createErrorPlaceholder: () => {
        throw new Error("unexpected error placeholder");
      }
    }
  );

  const pending = loader.loadPinnedItemsForEnvironment(environment);
  // With batching, lookups past the first batch would wait for "a"; the pool starts them anyway.
  await lastStarted;
  assert.deepEqual(started, names);
  releaseFirst();

  const items = await pending;
  assert.deepEqual(
    items.map((item) => (item as JobTreeItem).jobUrl),
    entries.map((entry) => entry.jobUrl)
  );
});
