import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { toPipelineRun } from "../src/jenkins/pipeline/JenkinsPipelineAdapter";
import type { JenkinsWorkflowRun } from "../src/jenkins/types";

function buildWorkflowRun(stepDuration: {
  durationMillis?: number;
  execDurationMillis?: number;
}): JenkinsWorkflowRun {
  return {
    stages: [
      {
        id: "1",
        name: "Build",
        stageFlowNodes: [
          {
            id: "2",
            name: "Shell",
            ...stepDuration
          }
        ]
      }
    ]
  };
}

describe("JenkinsPipelineAdapter", () => {
  it("omits invalid step durations", () => {
    const run = toPipelineRun(buildWorkflowRun({ durationMillis: Number.NaN }));

    assert.equal(run?.stages[0]?.steps[0]?.durationMillis, undefined);
  });

  it("falls back to step execDurationMillis when durationMillis is invalid", () => {
    const run = toPipelineRun(
      buildWorkflowRun({ durationMillis: Number.POSITIVE_INFINITY, execDurationMillis: 1250 })
    );

    assert.equal(run?.stages[0]?.steps[0]?.durationMillis, 1250);
  });

  it("uses populated fallback steps when stageFlowNodes is empty", () => {
    const run = toPipelineRun({
      stages: [
        {
          id: "1",
          name: "Build",
          stageFlowNodes: [],
          steps: [{ id: "2", name: "Shell" }]
        }
      ]
    });

    const stepNames = run?.stages[0]?.steps.map((step) => step.name);
    assert.deepEqual(stepNames, ["Shell"]);
  });

  it("uses populated fallback branches when earlier aliases are empty", () => {
    const run = toPipelineRun({
      stages: [
        {
          id: "1",
          name: "Parallel",
          parallelStages: [],
          branches: [],
          children: [{ id: "3", name: "Linux" }]
        }
      ]
    });

    const branchNames = run?.stages[0]?.parallelBranches.map((branch) => branch.name);
    assert.deepEqual(branchNames, ["Linux"]);
  });
});
