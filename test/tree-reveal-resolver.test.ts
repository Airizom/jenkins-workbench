import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JobSearchEntry } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsTreeRevealResolver } from "../src/tree/TreeRevealResolver";
import { PlaceholderTreeItem } from "../src/tree/items/TreePlaceholderItem";
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
});
