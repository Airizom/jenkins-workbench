import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsBuild } from "../src/jenkins/JenkinsClient";
import { buildBuildTooltip } from "../src/tree/BuildTooltips";

function createBuild(overrides: Partial<JenkinsBuild> = {}): JenkinsBuild {
  return {
    number: 7,
    url: "https://jenkins.example/job/demo/7/",
    ...overrides
  };
}

function causeTooltipValue(build: JenkinsBuild): string {
  return buildBuildTooltip(build).value;
}

describe("buildBuildTooltip cause summaries", () => {
  it("falls back to the build url when there are no actions", () => {
    const build = createBuild();

    assert.equal(causeTooltipValue(build), build.url);
  });

  it("ignores null actions and actions without a causes array", () => {
    const build = createBuild({
      actions: [null, { _class: "hudson.model.ParametersAction" }, { causes: undefined }]
    });

    assert.equal(causeTooltipValue(build), build.url);
  });

  it("renders a cause description without a user suffix when no user is present", () => {
    const build = createBuild({
      actions: [{ causes: [{ shortDescription: "Started by an SCM change" }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Started by an SCM change");
  });

  it("appends the user when the description does not mention them", () => {
    const build = createBuild({
      actions: [{ causes: [{ shortDescription: "Replayed #6", userName: "alice" }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Replayed #6 (alice)");
  });

  it("omits the user suffix when the description already contains the user", () => {
    const build = createBuild({
      actions: [{ causes: [{ shortDescription: "Started by user alice", userName: "alice" }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Started by user alice");
  });

  it("matches the user in the description case-insensitively", () => {
    const build = createBuild({
      actions: [{ causes: [{ shortDescription: "Started by user Alice", userName: "alice" }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Started by user Alice");
  });

  it("falls back to a triggered-by summary when only a user name is present", () => {
    const build = createBuild({
      actions: [{ causes: [{ userName: "alice" }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Triggered by alice");
  });

  it("uses the user id when no user name is present", () => {
    const build = createBuild({
      actions: [{ causes: [{ userId: "uid-42" }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Triggered by uid-42");
  });

  it("skips causes with neither description nor user", () => {
    const build = createBuild({
      actions: [{ causes: [{}, { shortDescription: "   " }, { userName: " " }] }]
    });

    assert.equal(causeTooltipValue(build), build.url);
  });

  it("joins causes from multiple actions with a separator", () => {
    const build = createBuild({
      actions: [
        { causes: [{ shortDescription: "Started by timer" }] },
        { causes: [{ userName: "alice" }, { shortDescription: "Rebuilds #5", userName: "bob" }] }
      ]
    });

    assert.equal(
      causeTooltipValue(build),
      "**Cause:** Started by timer | Triggered by alice | Rebuilds #5 (bob)"
    );
  });

  it("normalizes whitespace inside cause descriptions and user names", () => {
    const build = createBuild({
      actions: [{ causes: [{ shortDescription: "Started\n by   timer ", userName: "  bo b " }] }]
    });

    assert.equal(causeTooltipValue(build), "**Cause:** Started by timer (bo b)");
  });
});
