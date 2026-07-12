import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { JenkinsWorkflowRun } from "../src/jenkins/types";
import { buildStagesSection } from "../src/panels/buildCompare/BuildCompareStagesSection";

function availableWorkflowRun(value: JenkinsWorkflowRun) {
  return { status: "available" as const, value };
}

describe("buildStagesSection", () => {
  it("assigns unique keys to duplicate stage paths", () => {
    const run: JenkinsWorkflowRun = {
      stages: [
        { name: "Test", status: "SUCCESS", durationMillis: 100 },
        { name: "Test", status: "SUCCESS", durationMillis: 200 }
      ]
    };

    const section = buildStagesSection(availableWorkflowRun(run), availableWorkflowRun(run));

    assert.deepEqual(
      section.items.map((item) => item.name),
      ["Test", "Test"]
    );
    assert.equal(new Set(section.items.map((item) => item.key)).size, section.items.length);
  });

  it("marks timing deltas with a direction for matched stages", () => {
    const baseline: JenkinsWorkflowRun = {
      stages: [
        { name: "Slower", status: "SUCCESS", durationMillis: 1_000 },
        { name: "Faster", status: "SUCCESS", durationMillis: 5_000 },
        { name: "Same", status: "SUCCESS", durationMillis: 2_000 }
      ]
    };
    const target: JenkinsWorkflowRun = {
      stages: [
        { name: "Slower", status: "SUCCESS", durationMillis: 3_000 },
        { name: "Faster", status: "SUCCESS", durationMillis: 1_000 },
        { name: "Same", status: "SUCCESS", durationMillis: 2_000 }
      ]
    };

    const section = buildStagesSection(
      availableWorkflowRun(baseline),
      availableWorkflowRun(target)
    );
    const byName = new Map(section.items.map((item) => [item.name, item]));

    assert.equal(byName.get("Slower")?.deltaDirection, "slower");
    assert.match(byName.get("Slower")?.deltaLabel ?? "", /^\+/);
    assert.equal(byName.get("Faster")?.deltaDirection, "faster");
    assert.match(byName.get("Faster")?.deltaLabel ?? "", /^-/);
    assert.equal(byName.get("Same")?.deltaDirection, undefined);
    assert.equal(byName.get("Same")?.deltaLabel, "No change");
  });

  it("leaves delta direction undefined for added and removed stages", () => {
    const baseline: JenkinsWorkflowRun = {
      stages: [{ name: "Removed", status: "SUCCESS", durationMillis: 1_000 }]
    };
    const target: JenkinsWorkflowRun = {
      stages: [{ name: "Added", status: "SUCCESS", durationMillis: 1_000 }]
    };

    const section = buildStagesSection(
      availableWorkflowRun(baseline),
      availableWorkflowRun(target)
    );

    for (const item of section.items) {
      assert.equal(item.deltaLabel, undefined);
      assert.equal(item.deltaDirection, undefined);
    }
  });
});
