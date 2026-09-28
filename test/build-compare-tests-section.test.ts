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

describe("buildTestsSection duplicate identities", () => {
  function counts(section: ReturnType<typeof buildTestsSection>) {
    return {
      newFailures: section.newFailures.length,
      stillFailing: section.stillFailing.length,
      newPasses: section.newPasses.length,
      added: section.addedTests.length,
      removed: section.removedTests.length,
      other: section.otherChanges.length,
      unchanged: section.unchangedCount,
      ambiguous: section.ambiguousTests.length
    };
  }

  const NONE = {
    newFailures: 0,
    stillFailing: 0,
    newPasses: 0,
    added: 0,
    removed: 0,
    other: 0,
    unchanged: 0,
    ambiguous: 1
  };

  it("does not pair [failed, passed] with [passed, failed] by position", () => {
    const baseline = report([
      { name: "dup", status: "FAILED" },
      { name: "dup", status: "PASSED" }
    ]);
    const target = report([
      { name: "dup", status: "PASSED" },
      { name: "dup", status: "FAILED" }
    ]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.deepEqual(counts(section), NONE);
    assert.deepEqual(section.ambiguousTests[0]?.baselineStatusLabels, ["Failed", "Passed"]);
    assert.deepEqual(section.ambiguousTests[0]?.targetStatusLabels, ["Passed", "Failed"]);
    assert.equal(section.status, "available");
    assert.match(
      section.summaryLabel,
      /New failures 0 · Still failing 0 · Newly passing 0 · 1 ambiguous/
    );
  });

  it("does not treat a lost duplicate as newly passing or removed", () => {
    const baseline = report([
      { name: "dup", status: "FAILED" },
      { name: "dup", status: "PASSED" }
    ]);
    const target = report([{ name: "dup", status: "PASSED" }]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.deepEqual(counts(section), NONE);
    assert.deepEqual(section.ambiguousTests[0]?.targetStatusLabels, ["Passed"]);
  });

  it("keeps duplicates present on only one side ambiguous instead of added", () => {
    const baseline = report([]);
    const target = report([
      { name: "dup", status: "FAILED" },
      { name: "dup", status: "FAILED" }
    ]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.deepEqual(counts(section), NONE);
    assert.deepEqual(section.ambiguousTests[0]?.baselineStatusLabels, []);
  });

  it("renders ambiguous tests in a neutral group with explanatory copy", () => {
    const baseline = report([
      { name: "dup", status: "FAILED" },
      { name: "dup", status: "PASSED" }
    ]);
    const target = report([{ name: "dup", status: "PASSED" }]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));
    const html = renderToStaticMarkup(createElement(TestDiffSection, { section }));

    assert.match(html, /Ambiguous/);
    assert.match(
      html,
      /Duplicate test identity — can(&#x27;|')t be matched reliably between builds/
    );
    assert.match(html, /Failed, Passed/);
    assert.match(html, /2 cases/);
    assert.doesNotMatch(html, /No test changes between these builds/);
  });
});

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
    const target = report([{ name: "added", status: "SKIPPED" }]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.equal(section.addedTests.length, 1);
    assert.equal(section.addedTests[0]?.baselineStatusTone, undefined);
    assert.equal(section.addedTests[0]?.targetStatusTone, "skipped");
    assert.equal(section.removedTests.length, 1);
    assert.equal(section.removedTests[0]?.baselineStatusTone, "passed");
    assert.equal(section.removedTests[0]?.targetStatusTone, undefined);
  });

  it("counts an added test that fails as a new failure", () => {
    const baseline = report([{ name: "existing", status: "PASSED" }]);
    const target = report([
      { name: "existing", status: "PASSED" },
      { name: "added", status: "FAILED" }
    ]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.equal(section.addedTests.length, 0);
    assert.equal(section.newFailures.length, 1);
    assert.equal(section.newFailures[0]?.name, "added");
    assert.equal(section.newFailures[0]?.addedInTarget, true);
    assert.equal(section.newFailures[0]?.targetStatusTone, "failed");
    assert.match(section.summaryLabel, /^New failures 1 · /);

    const html = renderToStaticMarkup(createElement(TestDiffSection, { section }));
    assert.match(html, /New failures/);
    assert.match(html, /New test/);
  });

  it("lists other status changes with both statuses", () => {
    const baseline = report([{ name: "flaky", status: "FAILED" }]);
    const target = report([{ name: "flaky", status: "SKIPPED" }]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    assert.equal(section.status, "available");
    assert.equal(section.otherChanges.length, 1);
    assert.equal(section.otherChanges[0]?.baselineStatusLabel, "Failed");
    assert.equal(section.otherChanges[0]?.targetStatusLabel, "Skipped");
    assert.equal(section.newPasses.length, 0);

    const html = renderToStaticMarkup(createElement(TestDiffSection, { section }));
    assert.match(html, /Other status changes/);
    assert.match(html, /flaky/);
    assert.doesNotMatch(html, /Other test changes/);
  });

  it("shows unchanged tests as a muted note, not a summary card", () => {
    const baseline = report([
      { name: "a", status: "PASSED" },
      { name: "b", status: "PASSED" }
    ]);
    const target = report([
      { name: "a", status: "PASSED" },
      { name: "b", status: "FAILED" }
    ]);

    const section = buildTestsSection(availableReport(baseline), availableReport(target));
    const html = renderToStaticMarkup(createElement(TestDiffSection, { section }));

    assert.match(html, /1 test unchanged/);
    assert.doesNotMatch(html, /Unchanged tests/);
  });

  it("does not match distinct cases whose fields contain key delimiters", () => {
    const baseline: JenkinsTestReport = {
      suites: [{ name: "C", cases: [{ className: "A::B", name: "D", status: "PASSED" }] }]
    };
    const target: JenkinsTestReport = {
      suites: [{ name: "B::C", cases: [{ className: "A", name: "D", status: "FAILED" }] }]
    };

    const section = buildTestsSection(availableReport(baseline), availableReport(target));

    // The unmatched target case is an added (failing) test, not a regression of the baseline case.
    assert.equal(section.newFailures.length, 1);
    assert.equal(section.newFailures[0]?.addedInTarget, true);
    assert.equal(section.addedTests.length, 0);
    assert.equal(section.removedTests.length, 1);
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
