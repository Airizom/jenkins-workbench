import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildCoverageStateViewModel } from "../src/panels/buildDetails/BuildDetailsCoverageViewModel";

describe("BuildDetailsCoverageViewModel", () => {
  it("counts mixed modified coverage ranges by block type", () => {
    const viewModel = buildCoverageStateViewModel(undefined, undefined, {
      actionPath: "coverage",
      coverageFetched: true,
      enabled: true,
      modifiedFiles: [
        {
          path: "src/example.ts",
          blocks: [
            { startLine: 2, endLine: 4, type: "covered" },
            { startLine: 7, endLine: 7, type: "missed" },
            { startLine: 9, endLine: 10, type: "partial" },
            { startLine: 12, endLine: 13, type: "covered" }
          ]
        }
      ]
    });

    assert.deepEqual(viewModel.modifiedFiles, [
      {
        path: "src/example.ts",
        coveredCount: 5,
        missedCount: 1,
        partialCount: 2
      }
    ]);
  });
});
