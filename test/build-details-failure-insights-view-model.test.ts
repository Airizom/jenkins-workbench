import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildBuildFailureInsights } from "../src/panels/buildDetails/BuildDetailsFailureInsightsViewModel";

describe("buildBuildFailureInsights artifacts", () => {
  it("preserves paths with leading, trailing, or only whitespace", () => {
    const paths = [" report.txt", "report.txt ", " report.txt ", " ", "report.txt"];
    const insights = buildBuildFailureInsights({
      number: 1,
      url: "https://jenkins.example/job/test/1/",
      artifacts: paths.map((relativePath) => ({ fileName: "report.txt", relativePath }))
    });

    assert.deepEqual(
      insights.artifacts.map((artifact) => artifact.relativePath),
      paths
    );
  });

  it("omits artifacts with empty paths", () => {
    const insights = buildBuildFailureInsights({
      number: 1,
      url: "https://jenkins.example/job/test/1/",
      artifacts: [{ fileName: "report.txt", relativePath: "" }]
    });

    assert.deepEqual(insights.artifacts, []);
  });
});
