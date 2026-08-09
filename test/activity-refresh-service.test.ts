import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import type { TreeActivityOptions } from "../src/tree/ActivityTypes";
import { ActivityRefreshService } from "../src/tree/activity/ActivityRefreshService";

function createActivityOptions(refreshMinIntervalMs: number): TreeActivityOptions {
  return {
    maxItemsPerGroup: 10,
    collection: {
      maxScanResults: 100,
      jobSearchBatchSize: 20,
      pendingInputCandidateLimit: 10,
      pendingInputLookupConcurrency: 2,
      pendingInputBuildLookupLimit: 5,
      refreshMinIntervalMs
    }
  };
}

function createEnvironment(scope: JenkinsEnvironmentRef["scope"]): JenkinsEnvironmentRef {
  return {
    environmentId: "shared-id",
    scope,
    url: `https://${scope}.jenkins.example/`
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivityRefreshService", () => {
  it("tracks expanded environments by scope and applies updated refresh intervals", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const refreshed: JenkinsEnvironmentRef[] = [];
    const service = new ActivityRefreshService({
      activityOptions: createActivityOptions(10_000),
      refreshActivity: (environment) => refreshed.push(environment)
    });
    const workspace = createEnvironment("workspace");
    const global = createEnvironment("global");

    service.handleActivityFolderExpanded(workspace);
    service.handleActivityFolderExpanded(global);
    service.handleStatusTick();
    assert.deepEqual(refreshed, [workspace, global]);

    vi.advanceTimersByTime(5_000);
    service.handleStatusTick();
    assert.equal(refreshed.length, 2);

    service.updateOptions(createActivityOptions(5_000));
    service.handleStatusTick();
    assert.deepEqual(refreshed, [workspace, global, workspace, global]);
  });

  it("stops refreshing collapsed and removed environments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const refreshed: JenkinsEnvironmentRef[] = [];
    const service = new ActivityRefreshService({
      activityOptions: createActivityOptions(5_000),
      refreshActivity: (environment) => refreshed.push(environment)
    });
    const workspace = createEnvironment("workspace");
    const global = createEnvironment("global");

    service.handleActivityFolderExpanded(workspace);
    service.handleActivityFolderExpanded(global);
    service.handleActivityFolderCollapsed(workspace);
    service.handleEnvironmentStoreChange({
      kind: "environment-removed",
      scope: global.scope,
      environmentId: global.environmentId
    });
    service.handleStatusTick();

    assert.deepEqual(refreshed, []);
  });
});
