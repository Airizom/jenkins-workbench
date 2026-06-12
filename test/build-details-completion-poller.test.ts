import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import { BuildDetailsCompletionPoller } from "../src/panels/buildDetails/BuildDetailsCompletionPoller";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 250;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  assert.ok(predicate(), "timed out waiting for condition");
}

function buildDetails(): JenkinsBuildDetails {
  return {
    number: 1,
    url: "https://jenkins.example/job/example/1/",
    building: false
  };
}

describe("BuildDetailsCompletionPoller", () => {
  it("can restart after a scheduled poll is skipped while polling is disabled", async () => {
    let shouldPoll = true;
    let fetchCalls = 0;
    const poller = new BuildDetailsCompletionPoller({
      getRefreshIntervalMs: () => 1,
      fetchBuildDetails: async () => {
        fetchCalls += 1;
        return buildDetails();
      },
      isTokenCurrent: () => true,
      shouldPoll: () => shouldPoll,
      onDetailsUpdate: () => {
        shouldPoll = false;
      }
    });

    poller.start(1);
    shouldPoll = false;
    await delay(20);

    assert.equal(fetchCalls, 0);

    shouldPoll = true;
    poller.start(1);
    await waitFor(() => fetchCalls >= 1);
    poller.stop();

    assert.equal(fetchCalls, 1);
  });
});
