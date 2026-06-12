import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JenkinsEnvironmentRef } from "../src/jenkins/JenkinsEnvironmentRef";
import { JenkinsQueuePoller } from "../src/queue/JenkinsQueuePoller";

interface PollerInternals {
  poll(): void;
}

function environment(overrides: Partial<JenkinsEnvironmentRef> = {}): JenkinsEnvironmentRef {
  return {
    scope: "workspace",
    environmentId: "env-1",
    url: "https://jenkins.example",
    ...overrides
  };
}

function createPollerFixture(pollIntervalSeconds = 2): {
  poller: JenkinsQueuePoller;
  refreshes: JenkinsEnvironmentRef[];
} {
  const refreshes: JenkinsEnvironmentRef[] = [];
  const poller = new JenkinsQueuePoller(
    {
      refreshQueueOnly: (environmentRef) => {
        refreshes.push(environmentRef);
      }
    },
    pollIntervalSeconds
  );

  return { poller, refreshes };
}

describe("JenkinsQueuePoller", () => {
  it("polls immediately on first expansion without duplicating the interval", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const env = environment();

    poller.trackExpanded(env);
    poller.trackExpanded(env);

    assert.deepEqual(refreshes, [env]);

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, [env, env]);

    poller.dispose();
  });

  it("polls expanded environments and stops after the last collapse", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const first = environment();
    const second = environment({
      scope: "global",
      environmentId: "env-2",
      url: "https://ci.example"
    });

    poller.trackExpanded(first);
    poller.trackExpanded(second);
    refreshes.length = 0;

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, [first, second]);

    poller.trackCollapsed(first);
    refreshes.length = 0;

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, [second]);

    poller.trackCollapsed(second);
    refreshes.length = 0;

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, []);
  });

  it("stops polling after clearAll and dispose", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const first = environment();

    poller.trackExpanded(first);
    poller.clearAll();
    refreshes.length = 0;

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, []);

    poller.trackExpanded(first);
    poller.dispose();
    refreshes.length = 0;

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, []);
  });

  it("replaces the active interval when the configured interval changes", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture(10);
    const env = environment();

    poller.trackExpanded(env);
    poller.updatePollIntervalSeconds(3);

    assert.deepEqual(refreshes, [env, env]);

    context.mock.timers.tick(2999);
    assert.equal(refreshes.length, 2);

    context.mock.timers.tick(1);
    assert.equal(refreshes.length, 3);

    context.mock.timers.tick(7000);
    assert.equal(refreshes.length, 5);

    poller.dispose();
  });

  it("uses the latest environment reference for an expanded environment key", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const initial = environment({ url: "https://old.example" });
    const updated = environment({ url: "https://new.example", username: "jenkins-user" });

    poller.trackExpanded(initial);
    poller.updateEnvironment(updated);
    refreshes.length = 0;

    context.mock.timers.tick(2000);
    assert.deepEqual(refreshes, [updated]);

    poller.dispose();
  });

  it("suppresses reentrant polls while a refresh is in progress", () => {
    const refreshes: JenkinsEnvironmentRef[] = [];
    let reentered = false;
    const env = environment();

    const poller = new JenkinsQueuePoller({
      refreshQueueOnly: (environmentRef) => {
        refreshes.push(environmentRef);
        if (!reentered) {
          reentered = true;
          (poller as unknown as PollerInternals).poll();
        }
      }
    });

    poller.trackExpanded(env);

    assert.deepEqual(refreshes, [env]);

    poller.dispose();
  });
});
