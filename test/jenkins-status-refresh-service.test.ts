import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { JenkinsStatusRefreshService } from "../src/services/JenkinsStatusRefreshService";

describe("JenkinsStatusRefreshService timer limits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([2_147_483.647, 2_592_000, Number.MAX_VALUE])(
    "starts with a supported timer delay for %s seconds",
    (seconds) => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const service = new JenkinsStatusRefreshService(seconds);

      try {
        service.start();

        assert.equal(service.getRefreshIntervalMs(), 2_147_483_647);
        assert.equal(setIntervalSpy.mock.calls[0]?.[1], 2_147_483_647);
      } finally {
        service.dispose();
      }
    }
  );

  it.each([2_592_000, Number.MAX_VALUE])(
    "replaces an active timer with a supported delay for %s seconds",
    (seconds) => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const service = new JenkinsStatusRefreshService();

      try {
        service.start();
        service.updateRefreshIntervalSeconds(seconds);

        assert.equal(setIntervalSpy.mock.calls.length, 2);
        assert.equal(setIntervalSpy.mock.calls[1]?.[1], 2_147_483_647);
        assert.equal(vi.getTimerCount(), 1);
      } finally {
        service.dispose();
      }
    }
  );
});
