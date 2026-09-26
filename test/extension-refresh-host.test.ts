import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

vi.mock("../src/extension/contextKeys", () => ({
  syncNoEnvironmentsContext: vi.fn(() => Promise.reject(new Error("context failed")))
}));

import { createExtensionRefreshHost } from "../src/extension/ExtensionRefreshHost";
import type { JenkinsQueuePoller } from "../src/queue/JenkinsQueuePoller";
import type { JenkinsEnvironmentStore } from "../src/storage/JenkinsEnvironmentStore";
import type { JenkinsWorkbenchTreeDataProvider } from "../src/tree/TreeDataProvider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createExtensionRefreshHost", () => {
  it("handles background failures after a successful full environment refresh", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const environmentStore = {
        listEnvironmentsWithScope: () => Promise.reject(new Error("list failed"))
      } as unknown as JenkinsEnvironmentStore;
      const treeDataProvider = {
        fullEnvironmentRefresh: () => true
      } as unknown as JenkinsWorkbenchTreeDataProvider;
      const updateEnvironment = vi.fn();
      const queuePoller = { updateEnvironment } as unknown as JenkinsQueuePoller;

      const host = createExtensionRefreshHost(environmentStore, treeDataProvider, queuePoller);
      const result = host.fullEnvironmentRefresh({ environmentId: "env-1" });

      assert.deepEqual(result, { executed: true });
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.deepEqual(unhandled, []);
      assert.equal(updateEnvironment.mock.calls.length, 0);
      assert.equal(warn.mock.calls.length, 2);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
