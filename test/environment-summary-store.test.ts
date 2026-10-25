import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type {
  JenkinsJobInfo,
  JenkinsNodeInfo,
  JenkinsQueueItemInfo
} from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { ScopedCache } from "../src/services/ScopedCache";
import { EnvironmentSummaryStore } from "../src/tree/EnvironmentSummaryStore";

const environment = { environmentId: "env-1", scope: "workspace" } as JenkinsEnvironmentRef;

function createStore(): { store: EnvironmentSummaryStore; notifications: () => number } {
  let count = 0;
  const store = new EnvironmentSummaryStore(new ScopedCache(60_000, 10), () => {
    count += 1;
  });
  return { store, notifications: () => count };
}

const job = (kind: string, color: string) => ({ kind, color }) as unknown as JenkinsJobInfo;
const node = (offline: boolean) => ({ offline }) as unknown as JenkinsNodeInfo;
const queueItem = {} as JenkinsQueueItemInfo;

describe("EnvironmentSummaryStore", () => {
  it("notifies only when a summary value changes", () => {
    const { store, notifications } = createStore();

    store.updateFromJobs(environment, [job("pipeline", "blue_anime"), job("freestyle", "red")]);
    store.updateFromJobs(environment, [job("pipeline", "blue_anime"), job("freestyle", "red")]);
    assert.equal(notifications(), 1);

    store.updateFromJobs(environment, [job("pipeline", "blue"), job("freestyle", "red")]);
    assert.equal(notifications(), 2);
    assert.equal(store.get(environment)?.jobs?.running, 0);

    store.updateFromNodes(environment, [node(false), node(true)]);
    store.updateFromNodes(environment, [node(true), node(false)]);
    assert.equal(notifications(), 3);

    store.updateFromNodes(environment, [node(false), node(false)]);
    assert.equal(notifications(), 4);

    store.updateFromQueue(environment, [queueItem]);
    store.updateFromQueue(environment, [queueItem]);
    assert.equal(notifications(), 5);

    store.updateFromQueue(environment, []);
    assert.equal(notifications(), 6);
    assert.deepEqual(store.getTotals(), { running: 0, queue: 0, hasData: true });
  });
});
