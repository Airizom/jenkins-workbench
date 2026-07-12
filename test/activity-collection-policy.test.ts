import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JobSearchEntry } from "../src/jenkins/JenkinsDataService";
import { ACTIVITY_GROUP_ORDER } from "../src/tree/ActivityTypes";
import type { ActivityEntry, ActivityGroups } from "../src/tree/activity/ActivityCollectionModel";
import {
  createActivityGroups,
  promoteAwaitingInputJobs
} from "../src/tree/activity/ActivityCollectionPolicy";

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

function activityEntry(entry: JobSearchEntry, group: ActivityEntry["group"]): ActivityEntry {
  return { entry, group };
}

describe("createActivityGroups", () => {
  it("creates an empty entry list for every activity group", () => {
    const groups = createActivityGroups();

    assert.equal(groups.size, ACTIVITY_GROUP_ORDER.length);
    for (const kind of ACTIVITY_GROUP_ORDER) {
      assert.deepEqual(groups.get(kind), []);
    }
  });
});

function assertPromotesNothing(
  selectAwaiting: (running: JobSearchEntry) => Set<string>,
  maxItems: number
): void {
  const groups = createActivityGroups();
  const running = createEntry("running-job", "red_anime");
  groups.get("running")?.push(activityEntry(running, "running"));

  promoteAwaitingInputJobs(groups, [running], selectAwaiting(running), maxItems);

  assert.deepEqual(groups.get("awaitingInput"), []);
  assert.equal(groups.get("running")?.length, 1);
}

function promoteTwoRunningJobs(
  selectAwaiting: (first: JobSearchEntry, second: JobSearchEntry) => Set<string>,
  maxItems: number
): { groups: ActivityGroups; first: JobSearchEntry; second: JobSearchEntry } {
  const groups = createActivityGroups();
  const first = createEntry("first", "red_anime");
  const second = createEntry("second", "blue_anime");
  groups.get("running")?.push(activityEntry(first, "running"));
  groups.get("running")?.push(activityEntry(second, "running"));

  promoteAwaitingInputJobs(groups, [first, second], selectAwaiting(first, second), maxItems);

  return { groups, first, second };
}

describe("promoteAwaitingInputJobs", () => {
  it("does nothing when no job urls are awaiting input", () => {
    assertPromotesNothing(() => new Set(), 5);
  });

  it("does nothing when the item limit is zero or negative", () => {
    assertPromotesNothing((running) => new Set([running.url]), 0);
  });

  it("promotes awaiting-input candidates and removes them from the other groups", () => {
    const groups = createActivityGroups();
    const awaitingJob = createEntry("deploy", "red_anime");
    const otherRunning = createEntry("build", "blue_anime");
    const failing = createEntry("deploy", "red");
    groups.get("running")?.push(activityEntry(awaitingJob, "running"));
    groups.get("running")?.push(activityEntry(otherRunning, "running"));
    groups.get("failing")?.push(activityEntry(failing, "failing"));

    promoteAwaitingInputJobs(groups, [awaitingJob, otherRunning], new Set([awaitingJob.url]), 5);

    assert.deepEqual(groups.get("awaitingInput"), [activityEntry(awaitingJob, "awaitingInput")]);
    assert.deepEqual(groups.get("running"), [activityEntry(otherRunning, "running")]);
    assert.deepEqual(groups.get("failing"), []);
  });

  it("skips candidates that are not awaiting input", () => {
    const { groups, first, second } = promoteTwoRunningJobs((_, b) => new Set([b.url]), 5);

    assert.deepEqual(groups.get("awaitingInput"), [activityEntry(second, "awaitingInput")]);
    assert.deepEqual(groups.get("running"), [activityEntry(first, "running")]);
  });

  it("stops promoting once the awaiting group reaches the item limit", () => {
    const { groups, first, second } = promoteTwoRunningJobs((a, b) => new Set([a.url, b.url]), 1);

    assert.deepEqual(groups.get("awaitingInput"), [activityEntry(first, "awaitingInput")]);
    assert.deepEqual(groups.get("running"), [activityEntry(second, "running")]);
  });

  it("leaves other groups untouched when the awaiting group is already full", () => {
    const groups = createActivityGroups();
    const existing = createEntry("existing", "red_anime");
    const candidate = createEntry("candidate", "blue_anime");
    groups.get("awaitingInput")?.push(activityEntry(existing, "awaitingInput"));
    groups.get("running")?.push(activityEntry(candidate, "running"));

    promoteAwaitingInputJobs(groups, [candidate], new Set([candidate.url]), 1);

    assert.deepEqual(groups.get("awaitingInput"), [activityEntry(existing, "awaitingInput")]);
    assert.deepEqual(groups.get("running"), [activityEntry(candidate, "running")]);
  });

  it("tolerates group maps that are missing group entries", () => {
    const candidate = createEntry("candidate", "red_anime");
    const groups: ActivityGroups = new Map();

    promoteAwaitingInputJobs(groups, [candidate], new Set([candidate.url]), 2);

    assert.deepEqual(groups.get("awaitingInput"), [activityEntry(candidate, "awaitingInput")]);
    assert.equal(groups.get("failing"), undefined);
    assert.equal(groups.get("unstable"), undefined);
    assert.equal(groups.get("running"), undefined);
  });
});
