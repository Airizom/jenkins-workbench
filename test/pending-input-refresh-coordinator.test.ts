import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
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

  it("isolates throwing summary listeners on immediate and throttled notifications", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      let signature = 0;
      const dataService = {
        refreshPendingInputSummary: async (): Promise<PendingInputSummary> => {
          signature += 1;
          return { awaitingInput: true, count: 1, fetchedAt: 1_000, signature: `s${signature}` };
        }
      } as unknown as JenkinsDataService;
      const coordinator = new PendingInputRefreshCoordinator(dataService, {
        refreshThrottleMs: 1_000
      });
      const received: string[] = [];
      coordinator.onSummaryChange(() => {
        throw new Error("listener failed");
      });
      coordinator.onSummaryChange((change) => {
        received.push(change.buildUrl);
      });

      const first = await coordinator.refreshSummary(environment, "https://jenkins.example/a/");
      assert.equal(first.signature, "s1");
      assert.deepEqual(received, ["https://jenkins.example/a/"]);

      const second = await coordinator.refreshSummary(environment, "https://jenkins.example/b/");
      assert.equal(second.signature, "s2");
      assert.deepEqual(received, ["https://jenkins.example/a/"]);

      assert.doesNotThrow(() => vi.runAllTimers());
      assert.deepEqual(received, ["https://jenkins.example/a/", "https://jenkins.example/b/"]);
      assert.equal(warn.mock.calls.length, 2);

      coordinator.dispose();
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
