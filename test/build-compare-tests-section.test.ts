import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type { JenkinsTestReport } from "../src/jenkins/types";
import { buildTestsSection } from "../src/panels/buildCompare/BuildCompareTestsSection";
import { TestDiffSection } from "../src/panels/buildCompare/webview/components/buildCompare/TestDiffSection";

function availableReport(value: JenkinsTestReport) {
  return { status: "available" as const, value };
}

function report(cases: Array<{ name: string; status: string }>): JenkinsTestReport {
  return {
    suites: [
      {
        name: "Suite",
        cases: cases.map((testCase) => ({
          name: testCase.name,
          className: "com.example.Suite",
          status: testCase.status
        }))
      }
    ]
  };
}

describe("buildTestsSection", () => {
  it("carries status tones for both sides of compared tests", () => {
    const baseline = report([
      { name: "regressed", status: "PASSED" },
      { name: "fixed", status: "FAILED" }
    ]);
    const target = report([
      { name: "regressed", status: "FAILED" },
      { name: "fixed", status: "PASSED" }
    ]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.equal(section.newFailures.length, 1);
    assert.equal(section.newFailures[0]?.baselineStatusTone, "passed");
    assert.equal(section.newFailures[0]?.targetStatusTone, "failed");
    assert.equal(section.newPasses.length, 1);
    assert.equal(section.newPasses[0]?.baselineStatusTone, "failed");
    assert.equal(section.newPasses[0]?.targetStatusTone, "passed");
  });

  it("only assigns a tone to the present side of added and removed tests", () => {
    const baseline = report([{ name: "removed", status: "PASSED" }]);
    const target = report([{ name: "added", status: "FAILED" }]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.equal(section.addedTests.length, 1);
    assert.equal(section.addedTests[0]?.baselineStatusTone, undefined);
    assert.equal(section.addedTests[0]?.targetStatusTone, "failed");
    assert.equal(section.removedTests.length, 1);
    assert.equal(section.removedTests[0]?.baselineStatusTone, "passed");
    assert.equal(section.removedTests[0]?.targetStatusTone, undefined);
  });

  it("does not describe unavailable test reports as unchanged", () => {
    const section = buildTestsSection({ status: "unavailable" }, { status: "unavailable" });

    const html = renderToStaticMarkup(createElement(TestDiffSection, { section }));

    assert.match(html, /Neither build exposed a Jenkins test report\./);
    assert.doesNotMatch(html, /No test changes between these builds\./);
  });

  it("does not describe test report errors as unchanged", () => {
    const section = buildTestsSection(
      { status: "error", message: "request failed" },
      availableReport(report([]))
    );

    const html = renderToStaticMarkup(createElement(TestDiffSection, { section }));

    assert.match(html, /Baseline test report: request failed/);
    assert.doesNotMatch(html, /No test changes between these builds\./);
  });
});
