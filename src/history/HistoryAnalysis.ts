import type { JenkinsBuild, JenkinsTestReport } from "../jenkins/types";
import { buildTestCaseKey } from "../panels/shared/TestCaseViewModel";
import { normalizeTestStatus } from "../panels/shared/TestStatusFormatters";

export type HistoryOutcome =
  | "passed"
  | "failed"
  | "skipped"
  | "unknown"
  | "missing"
  | "ambiguous"
  | "unavailable"
  | "error";
export interface HistoryCase {
  key: string;
  name: string;
  className?: string;
  suiteName?: string;
  outcome: HistoryOutcome;
  age?: number;
  failedSince?: number;
}
export interface HistoryReport {
  truncated?: boolean;
  status: "available" | "unavailable" | "error";
  cases: HistoryCase[];
  message?: string;
}
export interface HistoryBuild {
  build: JenkinsBuild;
  report: HistoryReport;
}
export function limitHistoryReport(report: HistoryReport, limit: number): HistoryReport {
  if (report.cases.length <= limit) return report;
  const cases: HistoryCase[] = [];
  for (const test of report.cases) {
    if (test.outcome === "failed") cases.push(test);
    if (cases.length === limit) break;
  }
  if (cases.length < limit)
    for (const test of report.cases) {
      if (test.outcome !== "failed") cases.push(test);
      if (cases.length === limit) break;
    }
  return { ...report, cases, truncated: true };
}
export interface TestHistory {
  key: string;
  name: string;
  className?: string;
  suiteName?: string;
  outcomes: HistoryOutcome[];
  passed: number;
  failed: number;
  skipped: number;
  unavailable: number;
  missing: number;
  unknown: number;
  ambiguous: number;
  errors: number;
  transitions: number;
  intermittent: boolean;
}
export interface FailureEvidence {
  kind: "new" | "continuing" | "firstObserved";
  label: string;
  source: "jenkins" | "sample";
}

export function normalizeHistoryReport(report: JenkinsTestReport | undefined): HistoryReport {
  if (!report) return { status: "unavailable", cases: [] };
  if (
    !Array.isArray(report.suites) ||
    report.suites.some((suite) => !Array.isArray(suite.cases)) ||
    ((report.totalCount ?? 0) > 0 && !report.suites.some((suite) => suite.cases?.length))
  ) {
    return { status: "unavailable", cases: [], message: "Detailed test cases unavailable." };
  }
  const cases = new Map<string, HistoryCase>();
  for (const suite of report.suites ?? []) {
    for (const test of suite.cases ?? []) {
      const name = test.name?.trim();
      if (!name) continue;
      const className = test.className?.trim() || undefined;
      const suiteName = suite.name?.trim() || undefined;
      const key = buildTestCaseKey(className, suiteName, name);
      const normalized = normalizeTestStatus(test.status);
      const outcome =
        cases.has(key) || (!className && !suiteName)
          ? "ambiguous"
          : normalized === "other"
            ? "unknown"
            : normalized;
      cases.set(key, {
        key,
        name,
        className,
        suiteName,
        outcome,
        age: test.age,
        failedSince: test.failedSince
      });
    }
  }
  return { status: "available", cases: [...cases.values()] };
}

export function failureEvidence(
  current: HistoryCase,
  buildNumber: number,
  previous?: HistoryOutcome
): FailureEvidence | undefined {
  if (current.outcome !== "failed") return undefined;
  const { age, failedSince } = current;
  const positive = (value: number | undefined) =>
    value === undefined || (Number.isSafeInteger(value) && value > 0);
  const valid =
    positive(age) &&
    positive(failedSince) &&
    (failedSince === undefined || failedSince <= buildNumber) &&
    (age === undefined || age <= buildNumber) &&
    !(age !== undefined && failedSince !== undefined && age > buildNumber - failedSince + 1) &&
    !(
      age !== undefined &&
      failedSince !== undefined &&
      (age === 1) !== (failedSince === buildNumber)
    );
  if (valid && (age !== undefined || failedSince !== undefined)) {
    const fresh = age === 1 || failedSince === buildNumber;
    return {
      kind: fresh ? "new" : "continuing",
      source: "jenkins",
      label: fresh
        ? "New failure"
        : `${failedSince ? `Failing since #${failedSince}` : "Still failing"}${age ? ` · Jenkins age ${age}` : ""}`
    };
  }
  return {
    kind: previous === "passed" ? "new" : previous === "failed" ? "continuing" : "firstObserved",
    source: "sample",
    label:
      previous === "passed"
        ? "New failure"
        : previous === "failed"
          ? "Still failing"
          : "First observed failure"
  };
}

export function analyzeTests(builds: HistoryBuild[], maxTests = 5000): TestHistory[] {
  const identities = new Map<string, HistoryCase>();
  const failingKeys = new Set<string>();
  const maps = builds.map(({ report }) => {
    const map = new Map(report.cases.map((test) => [test.key, test]));
    for (const test of report.cases) {
      identities.set(test.key, test);
      if (test.outcome === "failed") failingKeys.add(test.key);
    }
    return map;
  });
  const all = [...identities.values()];
  return [
    ...all.filter((test) => failingKeys.has(test.key)),
    ...all.filter((test) => !failingKeys.has(test.key))
  ]
    .slice(0, maxTests)
    .map((test) => {
      const outcomes = builds.map(
        ({ report }, index): HistoryOutcome =>
          report.status !== "available"
            ? report.status
            : (maps[index].get(test.key)?.outcome ?? (report.truncated ? "unavailable" : "missing"))
      );
      let previous: HistoryOutcome | undefined;
      let transitions = 0;
      let segmentTransitions = 0;
      let intermittent = false;
      for (const outcome of outcomes) {
        if (outcome !== "passed" && outcome !== "failed") {
          previous = undefined;
          segmentTransitions = 0;
          continue;
        }
        if (previous && previous !== outcome) {
          transitions++;
          segmentTransitions++;
          if (segmentTransitions >= 2) intermittent = true;
        }
        previous = outcome;
      }
      return {
        key: test.key,
        name: test.name,
        className: test.className,
        suiteName: test.suiteName,
        outcomes,
        passed: outcomes.filter((value) => value === "passed").length,
        failed: outcomes.filter((value) => value === "failed").length,
        skipped: outcomes.filter((value) => value === "skipped").length,
        unavailable: outcomes.filter((value) => value === "unavailable").length,
        missing: outcomes.filter((value) => value === "missing").length,
        unknown: outcomes.filter((value) => value === "unknown").length,
        ambiguous: outcomes.filter((value) => value === "ambiguous").length,
        errors: outcomes.filter((value) => value === "error").length,
        transitions,
        intermittent
      };
    })
    .sort(
      (a, b) =>
        Number(b.intermittent) - Number(a.intermittent) ||
        b.transitions - a.transitions ||
        b.failed / (b.failed + b.passed || 1) - a.failed / (a.failed + a.passed || 1) ||
        a.key.localeCompare(b.key)
    );
}

export function completionTime(build: JenkinsBuild): number | undefined {
  if (
    build.building ||
    !build.result ||
    !Number.isFinite(build.timestamp) ||
    !Number.isFinite(build.duration) ||
    (build.timestamp ?? -1) < 0 ||
    (build.duration ?? -1) < 0
  )
    return undefined;
  return (build.timestamp ?? 0) + (build.duration ?? 0);
}

export function historyMetrics(builds: JenkinsBuild[]) {
  const eligible = builds.filter(
    (build) => !build.building && ["SUCCESS", "UNSTABLE", "FAILURE"].includes(build.result ?? "")
  );
  const durations = eligible
    .map((build) => build.duration)
    .filter((value): value is number => value !== undefined && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return {
    successful: eligible.filter((build) => build.result === "SUCCESS").length,
    denominator: eligible.length,
    aborted: builds.filter((build) => build.result === "ABORTED").length,
    notBuilt: builds.filter((build) => build.result === "NOT_BUILT").length,
    unknown: builds.filter(
      (build) =>
        !["SUCCESS", "UNSTABLE", "FAILURE", "ABORTED", "NOT_BUILT"].includes(build.result ?? "")
    ).length,
    medianDuration: durations.length
      ? durations.length % 2
        ? durations[middle]
        : (durations[middle - 1] + durations[middle]) / 2
      : undefined
  };
}
