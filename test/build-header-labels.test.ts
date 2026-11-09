import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import type { JenkinsBuildDetails } from "../src/jenkins/types";
import { formatBuildHeaderLabels } from "../src/shared/build/BuildHeaderLabels";

describe("build header duration", () => {
  afterEach(() => vi.restoreAllMocks());

  const build: JenkinsBuildDetails = {
    number: 1,
    url: "http://jenkins/job/example/1/",
    building: true,
    timestamp: 1_000_000,
    duration: 0
  };

  it("uses elapsed time while Jenkins reports zero duration for an active build", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_065_000);
    assert.equal(formatBuildHeaderLabels(build).durationLabel, "1m 5s");
  });

  it("uses the recorded duration once the build finishes", () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000);
    assert.equal(
      formatBuildHeaderLabels({ ...build, building: false, duration: 12_000 }).durationLabel,
      "12s"
    );
  });

  it("handles missing timestamps and clock skew", () => {
    vi.spyOn(Date, "now").mockReturnValue(999_000);
    assert.equal(formatBuildHeaderLabels(build).durationLabel, "0 ms");
    assert.equal(
      formatBuildHeaderLabels({ ...build, timestamp: undefined, duration: 500 }).durationLabel,
      "500 ms"
    );
  });
});
