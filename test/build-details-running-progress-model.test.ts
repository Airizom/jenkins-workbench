import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { PipelineStageViewModel } from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  extractConsoleTail,
  findRunningStages
} from "../src/panels/buildDetails/webview/components/buildDetails/overview/runningProgressModel";

function makeStage(overrides: Partial<PipelineStageViewModel> = {}): PipelineStageViewModel {
  return {
    key: "stage",
    name: "Stage",
    statusLabel: "Success",
    statusClass: "success",
    durationLabel: "1s",
    canRestartFromStage: false,
    hasSteps: false,
    stepsFailedOnly: [],
    stepsAll: [],
    parallelBranches: [],
    canOpenLog: false,
    ...overrides
  };
}

describe("extractConsoleTail", () => {
  it("returns the last non-blank lines in order without ANSI escapes", () => {
    const text = "one\ntwo\n\n\u001b[1;31mthree\u001b[0m\r\n  \nfour\n";
    assert.deepEqual(extractConsoleTail(text, 3), ["two", "three", "four"]);
  });

  it("handles short and empty logs", () => {
    assert.deepEqual(extractConsoleTail("only line", 5), ["only line"]);
    assert.deepEqual(extractConsoleTail("", 5), []);
    assert.deepEqual(extractConsoleTail("\n\n", 5), []);
  });
});

describe("findRunningStages", () => {
  it("lists running stages with their running parallel branches", () => {
    const stages = [
      makeStage({ key: "a", name: "Checkout" }),
      makeStage({
        key: "b",
        name: "Tests",
        statusClass: "running",
        durationLabel: "40s",
        parallelBranches: [
          makeStage({ key: "b1", name: "Unit", statusClass: "running" }),
          makeStage({ key: "b2", name: "Lint" })
        ]
      })
    ];

    assert.deepEqual(findRunningStages(stages), [
      { key: "b", name: "Tests", durationLabel: "40s", branchNames: ["Unit"] }
    ]);
  });
});
