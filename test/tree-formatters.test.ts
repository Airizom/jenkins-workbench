import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsBuild } from "../src/jenkins/JenkinsClient";
import { formatBuildDescription, formatJobDescription } from "../src/tree/formatters";

describe("formatJobDescription", () => {
  it("describes a disabled job when no status is available", () => {
    assert.equal(formatJobDescription({ isDisabled: true }), "Disabled");
  });

  it("does not duplicate an existing disabled status", () => {
    assert.equal(
      formatJobDescription({ status: "Disabled", isDisabled: true, isPinned: true }),
      "Disabled • Pinned"
    );
  });
});

describe("formatJobDescription status noise", () => {
  it("omits the healthy status that the icon already shows", () => {
    assert.equal(formatJobDescription({ status: "Success" }), undefined);
    assert.equal(formatJobDescription({ status: "Success", isWatched: true }), "Watched");
  });

  it("keeps statuses that need attention", () => {
    assert.equal(formatJobDescription({ status: "Failed", isPinned: true }), "Failed • Pinned");
  });
});

describe("formatBuildDescription", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  afterEach(() => {
    vi.useRealTimers();
  });

  function build(overrides: Partial<JenkinsBuild>): JenkinsBuild {
    return { number: 1, url: "https://jenkins.example/job/a/1/", ...overrides };
  }

  it("shows result, duration, and when a finished build ended", () => {
    vi.useFakeTimers({ now });
    const description = formatBuildDescription(
      build({ result: "SUCCESS", timestamp: now - 2 * 3_600_000 - 60_000, duration: 60_000 })
    );
    assert.equal(description, "Success • 1m • 2h ago");
  });

  it("shows elapsed time against the estimate without a character-art bar", () => {
    vi.useFakeTimers({ now });
    const description = formatBuildDescription(
      build({ building: true, timestamp: now - 120_000, estimatedDuration: 300_000 })
    );
    assert.equal(description, "Running • 2m of ~5m");
  });

  it("marks a build that overran its estimate instead of clamping to 100%", () => {
    vi.useFakeTimers({ now });
    const description = formatBuildDescription(
      build({ building: true, timestamp: now - 420_000, estimatedDuration: 300_000 })
    );
    assert.equal(description, "Running • 7m, over ~5m estimate");
  });

  it("leads with awaiting input for paused builds", () => {
    vi.useFakeTimers({ now });
    const description = formatBuildDescription(
      build({ building: true, timestamp: now - 60_000 }),
      true
    );
    assert.equal(description, "Awaiting input • 1m");
  });
});
