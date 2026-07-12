import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { JenkinsReplayClient } from "../src/jenkins/client/JenkinsReplayClient";
import type { JenkinsReplaySubmissionPayload } from "../src/jenkins/types";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const BUILD_URL = "https://jenkins.example.com/job/demo/5/";
const JOB_TASK_URL = "https://jenkins.example.com/job/demo/";
const OTHER_TASK_URL = "https://jenkins.example.com/job/other/";

const PAYLOAD: JenkinsReplaySubmissionPayload = {
  mainScript: "echo hi",
  loadedScripts: []
};

interface FakeQueueItem {
  id?: number;
  task?: { url?: string };
}

// The first response answers the pre-submission snapshot; later responses
// answer the discovery polls. The last entry repeats for extra polls.
function createReplayFixture(options: {
  queueResponses: Array<FakeQueueItem[] | Error>;
  postLocation?: string;
}): { client: JenkinsReplayClient; queueCalls: () => number } {
  let queueCallCount = 0;
  const context = createJenkinsClientContext({
    requestJson: async <T>(): Promise<T> => {
      const index = Math.min(queueCallCount, options.queueResponses.length - 1);
      queueCallCount += 1;
      const response = options.queueResponses[index];
      if (response instanceof Error) {
        throw response;
      }
      return { items: response } as T;
    },
    requestPostWithCrumb: async () => ({ location: options.postLocation })
  });
  return { client: new JenkinsReplayClient(context), queueCalls: () => queueCallCount };
}

function jobItem(id: number): FakeQueueItem {
  return { id, task: { url: JOB_TASK_URL } };
}

function useDiscoveryTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 0 });
}

describe("JenkinsReplayClient replay queue discovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a queue Location header from the response without polling", async () => {
    const { client, queueCalls } = createReplayFixture({
      queueResponses: [[]],
      postLocation: "https://jenkins.example.com/queue/item/42/"
    });

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/42/");
    assert.equal(result.location, "https://jenkins.example.com/queue/item/42/");
    assert.equal(result.buildLocation, undefined);
    assert.equal(queueCalls(), 1);
  });

  it("resolves a relative Location header against the replay run URL", async () => {
    const { client } = createReplayFixture({
      queueResponses: [[]],
      postLocation: "/queue/item/7/"
    });

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/7/");
  });

  it("classifies a redirect to a different build as a build location", async () => {
    const { client, queueCalls } = createReplayFixture({
      queueResponses: [[]],
      postLocation: "https://jenkins.example.com/job/demo/6/"
    });

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.buildLocation, "https://jenkins.example.com/job/demo/6/");
    assert.equal(result.location, "https://jenkins.example.com/job/demo/6/");
    assert.equal(result.queueLocation, undefined);
    assert.equal(queueCalls(), 1);
  });

  it("discovers the queue item once a single new candidate settles", async () => {
    useDiscoveryTimers();
    const { client } = createReplayFixture({
      queueResponses: [
        [],
        [
          { id: 99, task: { url: OTHER_TASK_URL } },
          { id: 98 },
          { task: { url: JOB_TASK_URL } },
          jobItem(10),
          jobItem(10)
        ]
      ],
      postLocation: BUILD_URL
    });

    const resultPromise = client.runReplay(BUILD_URL, PAYLOAD);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/10/");
    assert.equal(result.location, "https://jenkins.example.com/queue/item/10/");
    assert.equal(result.buildLocation, undefined);
  });

  it("ignores queue items that already existed before the replay", async () => {
    useDiscoveryTimers();
    const { client } = createReplayFixture({
      queueResponses: [[jobItem(10)], [jobItem(10), jobItem(11)]]
    });

    const resultPromise = client.runReplay(BUILD_URL, PAYLOAD);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/11/");
  });

  it("returns no location when multiple new queue items are candidates", async () => {
    useDiscoveryTimers();
    const { client } = createReplayFixture({
      queueResponses: [[], [jobItem(11), jobItem(12)]]
    });

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.location, undefined);
    assert.equal(result.queueLocation, undefined);
    assert.equal(result.buildLocation, undefined);
  });

  it("restarts the settle window when the candidate changes between polls", async () => {
    useDiscoveryTimers();
    const { client } = createReplayFixture({
      queueResponses: [[], [jobItem(11)], [jobItem(12)]]
    });

    const resultPromise = client.runReplay(BUILD_URL, PAYLOAD);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/12/");
  });

  it("restarts the settle window when the candidate disappears", async () => {
    useDiscoveryTimers();
    const { client } = createReplayFixture({
      queueResponses: [[], [jobItem(11)], [], [jobItem(11)]]
    });

    const resultPromise = client.runReplay(BUILD_URL, PAYLOAD);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await resultPromise;

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/11/");
  });

  it("retains a candidate that starts executing before the settle interval", async () => {
    useDiscoveryTimers();
    let queuePoll = 0;
    const context = createJenkinsClientContext({
      requestJson: async <T>(url: string): Promise<T> => {
        if (url.includes("queue/item/42/api/json")) {
          return {
            id: 42,
            task: { url: JOB_TASK_URL },
            executable: { url: "https://jenkins.example.com/job/demo/6/" }
          } as T;
        }
        const items = queuePoll++ === 1 ? [jobItem(42)] : [];
        return { items } as T;
      },
      requestPostWithCrumb: async () => ({ location: BUILD_URL })
    });
    const client = new JenkinsReplayClient(context);

    const resultPromise = client.runReplay(BUILD_URL, PAYLOAD);
    await vi.advanceTimersByTimeAsync(500);
    const result = await resultPromise;

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/42/");
    assert.equal(result.location, "https://jenkins.example.com/queue/item/42/");
  });

  it("abandons discovery when polling the queue fails", async () => {
    useDiscoveryTimers();
    const { client } = createReplayFixture({
      queueResponses: [[], new Error("queue unavailable")]
    });

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.location, undefined);
    assert.equal(result.queueLocation, undefined);
  });

  it("gives up when no queue item appears before the discovery timeout", async () => {
    useDiscoveryTimers();
    const { client, queueCalls } = createReplayFixture({
      queueResponses: [[]]
    });

    const resultPromise = client.runReplay(BUILD_URL, PAYLOAD);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;

    assert.equal(result.location, undefined);
    assert.ok(queueCalls() > 1);
  });

  it("skips discovery entirely when the pre-submission snapshot fails", async () => {
    const { client, queueCalls } = createReplayFixture({
      queueResponses: [new Error("queue unavailable")]
    });

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.location, undefined);
    assert.equal(queueCalls(), 1);
  });
});
