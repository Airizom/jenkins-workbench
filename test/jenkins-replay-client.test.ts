import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { JenkinsReplayClient } from "../src/jenkins/client/JenkinsReplayClient";
import { JenkinsRequestError } from "../src/jenkins/errors";
import type { JenkinsReplaySubmissionPayload } from "../src/jenkins/types";
import { createJenkinsClientContext } from "./helpers/jenkinsClientContext";

const BUILD_URL = "https://jenkins.example.com/job/demo/5/";

const PAYLOAD: JenkinsReplaySubmissionPayload = {
  mainScript: "echo hi",
  loadedScripts: []
};

function createReplayFixture(postLocation?: string): {
  client: JenkinsReplayClient;
  queueCalls: () => number;
} {
  let queueCallCount = 0;
  const context = createJenkinsClientContext({
    requestJson: async <T>(): Promise<T> => {
      queueCallCount += 1;
      return {
        items: [
          {
            id: 41,
            task: { url: "https://jenkins.example.com/job/demo/" }
          }
        ]
      } as T;
    },
    requestPostWithCrumb: async () => ({ location: postLocation })
  });
  return { client: new JenkinsReplayClient(context), queueCalls: () => queueCallCount };
}

describe("JenkinsReplayClient replay result locations", () => {
  it("uses a queue Location header from the response without polling", async () => {
    const { client, queueCalls } = createReplayFixture(
      "https://jenkins.example.com/queue/item/42/"
    );

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/42/");
    assert.equal(result.location, "https://jenkins.example.com/queue/item/42/");
    assert.equal(result.buildLocation, undefined);
    assert.equal(queueCalls(), 0);
  });

  it("resolves a relative Location header against the replay run URL", async () => {
    const { client } = createReplayFixture("/queue/item/7/");

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.queueLocation, "https://jenkins.example.com/queue/item/7/");
  });

  it("classifies a redirect to a different build as a build location", async () => {
    const { client, queueCalls } = createReplayFixture("https://jenkins.example.com/job/demo/6/");

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.buildLocation, "https://jenkins.example.com/job/demo/6/");
    assert.equal(result.location, "https://jenkins.example.com/job/demo/6/");
    assert.equal(result.queueLocation, undefined);
    assert.equal(queueCalls(), 0);
  });

  it.each([
    "https://attacker.example/queue/item/123/",
    "javascript:/queue/item/123/",
    "blob:https://jenkins.example.com/queue/item/123/",
    "blob:https://jenkins.example.com/job/demo/6/",
    "filesystem:https://jenkins.example.com/temporary/queue/item/123/",
    "http://[::1"
  ])("rejects an untrusted or invalid Location header: %s", async (postLocation) => {
    const { client } = createReplayFixture(postLocation);

    await assert.rejects(client.runReplay(BUILD_URL, PAYLOAD), JenkinsRequestError);
  });

  it.each([
    "https://jenkins.example.com/replay/result?next=/queue/item/123/",
    "https://jenkins.example.com/replay/result?next=/job/demo/6/"
  ])("does not classify a Location marker outside the URL pathname: %s", async (postLocation) => {
    const { client } = createReplayFixture(postLocation);

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.location, undefined);
    assert.equal(result.queueLocation, undefined);
    assert.equal(result.buildLocation, undefined);
  });

  it("does not attribute an uncorrelated same-job queue item to the replay", async () => {
    const { client, queueCalls } = createReplayFixture();

    const result = await client.runReplay(BUILD_URL, PAYLOAD);

    assert.equal(result.location, undefined);
    assert.equal(result.queueLocation, undefined);
    assert.equal(result.buildLocation, undefined);
    assert.equal(queueCalls(), 0);
  });
});
