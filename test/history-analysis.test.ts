import { describe, expect, it } from "vitest";
import {
  analyzeTests,
  failureEvidence,
  historyMetrics,
  limitHistoryReport,
  normalizeHistoryReport,
  type HistoryBuild
} from "../src/history/HistoryAnalysis";
import { buildTestReportTree } from "../src/jenkins/client/JenkinsBuildTreeBuilders";

function observation(status: string, number: number): HistoryBuild {
  return {
    build: { number, url: `https://example.com/job/a/${number}/` },
    report: normalizeHistoryReport({
      suites: [{ name: "suite", cases: [{ name: "test[1]", className: "Class", status }] }]
    })
  };
}
describe("history evidence", () => {
  it("prioritizes older failing identities over newer passing identities at the matrix cap", () => {
    const report = (status: string, names: string[]) =>
      normalizeHistoryReport({
        suites: [{ name: "s", cases: names.map((name) => ({ name, status })) }]
      });
    const tests = analyzeTests(
      [
        {
          build: { number: 2, url: "https://example.test/2" },
          report: report("PASSED", ["one", "two", "three"])
        },
        {
          build: { number: 1, url: "https://example.test/1" },
          report: report("FAILED", ["olderFailure"])
        }
      ],
      2
    );
    expect(tests).toHaveLength(2);
    expect(tests.some((test) => test.name === "olderFailure")).toBe(true);
  });
  it("marks omitted observations unavailable and preserves failing cases within a budget", () => {
    const full = normalizeHistoryReport({
      suites: [
        {
          name: "s",
          cases: Array.from({ length: 100 }, (_, index) => ({
            name: `t${index}`,
            status: index === 99 ? "FAILED" : "PASSED"
          }))
        }
      ]
    });
    const limited = limitHistoryReport(full, 10);
    expect(limited.cases).toHaveLength(10);
    expect(limited.cases[0].name).toBe("t99");
    expect(limited.truncated).toBe(true);
    const builds = [
      { build: { number: 2, url: "https://example.test/2" }, report: full },
      { build: { number: 1, url: "https://example.test/1" }, report: limited }
    ];
    const tests = analyzeTests(builds);
    expect(tests.find((test) => test.name === "t50")?.outcomes[1]).toBe("unavailable");
    expect(analyzeTests(builds, 5)).toHaveLength(5);
    expect(normalizeHistoryReport({ totalCount: 100 }).status).toBe("unavailable");
  });
  it("requires repeated transitions and breaks sequences at gaps", () => {
    expect(analyzeTests([observation("FAILED", 3), observation("PASSED", 2)])[0].intermittent).toBe(
      false
    );
    expect(
      analyzeTests([
        observation("FAILED", 3),
        observation("PASSED", 2),
        observation("FAILED", 1)
      ])[0].intermittent
    ).toBe(true);
    expect(
      analyzeTests([
        observation("FAILED", 4),
        observation("SKIPPED", 3),
        observation("PASSED", 2),
        observation("FAILED", 1)
      ])[0].intermittent
    ).toBe(false);
  });
  it("does not match duplicate identities by occurrence", () => {
    const test = { name: "test", className: "Class", status: "FAILED" };
    const report = normalizeHistoryReport({
      suites: [{ name: "suite", cases: [test, { ...test, status: "PASSED" }] }]
    });
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0].outcome).toBe("ambiguous");
  });
  it("rejects contradictory and invalid onset metadata", () => {
    const test = observation("FAILED", 10).report.cases[0];
    expect(failureEvidence({ ...test, age: 2 }, 10)?.kind).toBe("continuing");
    expect(failureEvidence({ ...test, age: 1, failedSince: 5 }, 10)?.source).toBe("sample");
    expect(failureEvidence({ ...test, age: 8, failedSince: 9 }, 10)?.source).toBe("sample");
    expect(failureEvidence({ ...test, failedSince: 11 }, 10)?.label).toBe("First observed failure");
    expect(failureEvidence({ ...test, age: 2, failedSince: 8 }, 10)?.label).toContain(
      "Failing since #8"
    );
    expect(failureEvidence(test, 10, "passed")?.label).toBe("New failure");
    expect(failureEvidence(test, 10, "missing")?.label).toBe("First observed failure");
  });
  it("excludes aborted runs and unknown durations from metrics", () => {
    const builds = ["SUCCESS", "UNSTABLE", "FAILURE", "ABORTED", "NOT_BUILT"].map(
      (result, number) => ({
        result,
        number,
        url: "https://example.com/",
        duration: number === 1 ? undefined : 100
      })
    );
    expect(historyMetrics(builds)).toEqual({
      successful: 1,
      denominator: 3,
      aborted: 1,
      notBuilt: 1,
      unknown: 0,
      medianDuration: 100
    });
    expect(historyMetrics([]).medianDuration).toBeUndefined();
  });
  it("fetches compact history without case logs even when requested", () => {
    const tree = buildTestReportTree({ projection: "history", includeCaseLogs: true });
    expect(tree).toContain("suites[name,cases[name,className,status,age,failedSince]]");
    expect(tree).not.toMatch(/errorDetails|stdout|stderr|StackTrace/);
    expect(buildTestReportTree()).toContain("errorDetails,duration");
  });
});
