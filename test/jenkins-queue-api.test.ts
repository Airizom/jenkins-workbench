import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsQueueApi } from "../src/jenkins/client/JenkinsQueueApi";
import { JenkinsRequestError } from "../src/jenkins/errors";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const INVALID_QUEUE_IDS = [
  7.9,
  0,
  -1,
  Number.MAX_SAFE_INTEGER + 1,
  Number.NaN,
  Number.POSITIVE_INFINITY
];

describe("JenkinsQueueApi queue item IDs", () => {
  it("rejects invalid IDs without requesting a queue item", async () => {
    const requests: string[] = [];
    const api = new JenkinsQueueApi(
      createJenkinsClientContext({
        requestJson: async <T>(url: string): Promise<T> => {
          requests.push(url);
          return {} as T;
        }
      })
    );

    for (const id of INVALID_QUEUE_IDS) {
      await assert.rejects(api.getQueueItem(id), JenkinsRequestError);
    }
    assert.deepEqual(requests, []);
  });

  it("rejects invalid IDs without making a cancellation request", async () => {
    const requests: string[] = [];
    const api = new JenkinsQueueApi(
      createJenkinsClientContext({
        requestVoidWithCrumb: async (url) => {
          requests.push(url);
        }
      })
    );

    for (const id of INVALID_QUEUE_IDS) {
      await assert.rejects(api.cancelQueueItem(id), JenkinsRequestError);
    }
    assert.deepEqual(requests, []);
  });

  it("preserves valid queue item IDs exactly", async () => {
    const itemRequests: string[] = [];
    const cancellationRequests: string[] = [];
    const api = new JenkinsQueueApi(
      createJenkinsClientContext({
        requestJson: async <T>(url: string): Promise<T> => {
          itemRequests.push(url);
          return {} as T;
        },
        requestVoidWithCrumb: async (url) => {
          cancellationRequests.push(url);
        }
      })
    );

    await api.getQueueItem(Number.MAX_SAFE_INTEGER);
    await api.cancelQueueItem(Number.MAX_SAFE_INTEGER);

    assert.match(itemRequests[0], /\/queue\/item\/9007199254740991\/api\/json\?/);
    assert.equal(new URL(cancellationRequests[0]).searchParams.get("id"), "9007199254740991");
  });
});
