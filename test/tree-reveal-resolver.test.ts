import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JobSearchEntry } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsTreeRevealResolver } from "../src/tree/TreeRevealResolver";
import { JobTreeItem } from "../src/tree/items/TreeJobItems";
import { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";
import {
  InstanceTreeItem,
  JobsFolderTreeItem,
  RootSectionTreeItem
} from "../src/tree/items/TreeRootItems";
import type { WorkbenchTreeElement } from "../src/tree/items/WorkbenchTreeElement";
import { EventEmitter } from "./helpers/vscodeStub";

const environment: JenkinsEnvironmentRef = {
  environmentId: "test",
  scope: "workspace",
  url: "https://jenkins.example/"
};

const entry: JobSearchEntry = {
  name: "demo",
  url: "https://jenkins.example/job/demo/",
  kind: "job",
  fullName: "demo",
  path: [{ name: "demo", url: "https://jenkins.example/job/demo/", kind: "job" }]
};

afterEach(() => {
  vi.useRealTimers();
});

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  assert.fail("Condition did not become true after flushing promises");
}

describe("JenkinsTreeRevealResolver", () => {
  it("settles when a loading placeholder remains cached", async () => {
    vi.useFakeTimers();
    const treeChanges = new EventEmitter<WorkbenchTreeElement | undefined>();
    const loading = new PlaceholderTreeItem("Loading jobs", undefined, "loading");
    let loadCount = 0;
    const resolver = new JenkinsTreeRevealResolver(async () => {
      loadCount += 1;
      return [loading];
    }, treeChanges.event);

    const resolution = resolver.resolveJobElement(environment, entry);
    await vi.advanceTimersByTimeAsync(12_000);

    assert.equal(await resolution, undefined);
    assert.equal(loadCount, 4);
    treeChanges.dispose();
  });

  it("accepts an equivalent parent while ignoring unrelated targeted changes", async () => {
    const treeChanges = new EventEmitter<WorkbenchTreeElement | undefined>();
    const root = new RootSectionTreeItem("Jenkins Instances", "instances");
    const instance = new InstanceTreeItem({
      id: environment.environmentId,
      scope: environment.scope,
      url: environment.url
    });
    const jobs = new JobsFolderTreeItem(environment);
    const job = new JobTreeItem({
      presentation: "job",
      variant: "default",
      environment,
      label: entry.name,
      jobUrl: entry.url
    });
    const loading = new PlaceholderTreeItem("Loading jobs", undefined, "loading");
    let jobsLoaded = false;
    let jobsReadCount = 0;
    const resolver = new JenkinsTreeRevealResolver(async (element) => {
      if (!element) {
        return [root];
      }
      if (element === root) {
        return [instance];
      }
      if (element === instance) {
        return [jobs];
      }
      if (element === jobs) {
        jobsReadCount += 1;
        return jobsLoaded ? [job] : [loading];
      }
      return [];
    }, treeChanges.event);

    const resolution = resolver.resolveJobElement(environment, entry);
    await flushUntil(() => jobsReadCount === 1);
    assert.equal(jobsReadCount, 1);

    treeChanges.fire({} as WorkbenchTreeElement);
    treeChanges.fire(instance);
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
    assert.equal(jobsReadCount, 1);

    jobsLoaded = true;
    const equivalentJobs = new JobsFolderTreeItem(environment);
    assert.notEqual(equivalentJobs, jobs);
    assert.equal(equivalentJobs.id, jobs.id);
    treeChanges.fire(equivalentJobs);

    assert.equal(await resolution, job);
    assert.equal(jobsReadCount, 2);
    treeChanges.dispose();
  });
});
