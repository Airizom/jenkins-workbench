import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
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
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately on first expansion without duplicating the interval", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const env = environment();

    poller.trackExpanded(env);
    poller.trackExpanded(env);

    assert.deepEqual(refreshes, [env]);

    vi.advanceTimersByTime(2000);
    assert.deepEqual(refreshes, [env, env]);

    poller.dispose();
  });

  it("polls expanded environments and stops after the last collapse", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
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

    vi.advanceTimersByTime(2000);
    assert.deepEqual(refreshes, [first, second]);

    poller.trackCollapsed(first);
    refreshes.length = 0;

    vi.advanceTimersByTime(2000);
    assert.deepEqual(refreshes, [second]);

    poller.trackCollapsed(second);
    refreshes.length = 0;

    vi.advanceTimersByTime(2000);
    assert.deepEqual(refreshes, []);
  });

  it("continues polling other environments after a refresh throws", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = environment();
    const second = environment({ environmentId: "env-2" });
    const refreshes: JenkinsEnvironmentRef[] = [];
    const error = new Error("refresh failed");
    const poller = new JenkinsQueuePoller(
      {
        refreshQueueOnly: (environmentRef) => {
          refreshes.push(environmentRef);
          if (environmentRef === first) {
            throw error;
          }
        }
      },
      2
    );

    try {
      assert.doesNotThrow(() => poller.trackExpanded(first));
      poller.trackExpanded(second);
      refreshes.length = 0;

      vi.advanceTimersByTime(2000);
      assert.deepEqual(refreshes, [first, second]);

      vi.advanceTimersByTime(2000);
      assert.deepEqual(refreshes, [first, second, first, second]);
      assert.deepEqual(warning.mock.calls, [
        ["Failed to refresh Jenkins queue.", error],
        ["Failed to refresh Jenkins queue.", error],
        ["Failed to refresh Jenkins queue.", error]
      ]);
    } finally {
      poller.dispose();
      warning.mockRestore();
    }
  });

  it("stops polling after clearAll and dispose", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const first = environment();

    poller.trackExpanded(first);
    poller.clearAll();
    refreshes.length = 0;

    vi.advanceTimersByTime(2000);
    assert.deepEqual(refreshes, []);

    poller.trackExpanded(first);
    poller.dispose();
    refreshes.length = 0;

    vi.advanceTimersByTime(2000);
    assert.deepEqual(refreshes, []);
  });

  it("replaces the active interval when the configured interval changes", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture(10);
    const env = environment();

    poller.trackExpanded(env);
    poller.updatePollIntervalSeconds(3);

    assert.deepEqual(refreshes, [env, env]);

    vi.advanceTimersByTime(2999);
    assert.equal(refreshes.length, 2);

    vi.advanceTimersByTime(1);
    assert.equal(refreshes.length, 3);

    vi.advanceTimersByTime(7000);
    assert.equal(refreshes.length, 5);

    poller.dispose();
  });

  it("caps oversized polling intervals at the maximum supported timer delay", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { poller } = createPollerFixture(2_147_484);

    poller.trackExpanded(environment());
    assert.equal(setIntervalSpy.mock.calls[0]?.[1], 2_147_483_647);

    poller.updatePollIntervalSeconds(Number.MAX_VALUE);
    assert.equal(setIntervalSpy.mock.calls.length, 1);

    poller.dispose();
    setIntervalSpy.mockRestore();
  });

  it("uses the latest environment reference for an expanded environment key", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], now: 0 });
    const { poller, refreshes } = createPollerFixture();
    const initial = environment({ url: "https://old.example" });
    const updated = environment({ url: "https://new.example", username: "jenkins-user" });

    poller.trackExpanded(initial);
    poller.updateEnvironment(updated);
    refreshes.length = 0;

    vi.advanceTimersByTime(2000);
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
