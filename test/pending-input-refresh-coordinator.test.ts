import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsDataService, PendingInputSummary } from "../src/jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { PendingInputRefreshCoordinator } from "../src/services/PendingInputRefreshCoordinator";

const environment: JenkinsEnvironmentRef = {
  environmentId: "prod",
  scope: "global",
  url: "https://jenkins.example/"
};

describe("PendingInputRefreshCoordinator", () => {
  it("deduplicates queued and foreground refreshes for the same build", async () => {
    const summary: PendingInputSummary = {
      awaitingInput: true,
      count: 1,
      fetchedAt: 1_000,
      signature: "input-1"
    };
    let resolveRefresh: ((value: PendingInputSummary) => void) | undefined;
    const refreshResult = new Promise<PendingInputSummary>((resolve) => {
      resolveRefresh = resolve;
    });
    let refreshCalls = 0;
    const dataService = {
      refreshPendingInputSummary: async () => {
        refreshCalls += 1;
        return refreshResult;
      }
    } as unknown as JenkinsDataService;
    const coordinator = new PendingInputRefreshCoordinator(dataService, {
      concurrency: 1,
      staleAfterMs: 0,
      refreshThrottleMs: 0
    });
    const buildUrl = "https://jenkins.example/job/app/42/";

    coordinator.queueRefresh(environment, [buildUrl], new Map());
    const foregroundRefresh = coordinator.refreshSummary(environment, buildUrl);

    assert.equal(refreshCalls, 1);
    assert.ok(resolveRefresh);
    resolveRefresh(summary);
    assert.deepEqual(await foregroundRefresh, summary);
    assert.equal(refreshCalls, 1);

    coordinator.dispose();
  });
});
