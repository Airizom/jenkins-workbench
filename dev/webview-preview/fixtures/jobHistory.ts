import {
  analyzeTests,
  type FailureEvidence,
  failureEvidence,
  type HistoryBuild,
  normalizeHistoryReport
} from "../../../src/history/HistoryAnalysis";
import type { JenkinsBuild, JenkinsTestReport } from "../../../src/jenkins/types";
import {
  emptyHistory,
  type HistoryViewModel
} from "../../../src/panels/jobHistory/shared/HistoryContracts";

const jobUrl = "https://jenkins.example.com/job/web-app/job/feature%252Fcheckout-v2/";
const now = Date.now();
const HOUR = 3_600_000;

type CaseSpec = { suite: string; className?: string; name: string };
const CHECKOUT: CaseSpec = {
  suite: "ui",
  className: "com.example.checkout.CheckoutFlowTest",
  name: "renders the order summary with discounts applied"
};
const PAYMENT: CaseSpec = {
  suite: "integration",
  className: "com.example.payments.PaymentGatewayIT",
  name: "retries a declined card once before surfacing the error to the customer"
};
const CONFIG: CaseSpec = {
  suite: "unit",
  className: "com.example.config.ConfigParserTest",
  name: "parses nested overrides"
};
const EXPORT: CaseSpec = {
  suite: "unit",
  className: "com.example.export.CsvExportTest",
  name: "exports legacy columns"
};
const PASSING: CaseSpec[] = Array.from({ length: 6 }, (_, index) => ({
  suite: "unit",
  className: "com.example.cart.CartServiceTest",
  name: `computes totals case ${index + 1}`
}));

type Status = "PASSED" | "FAILED" | "SKIPPED";
type BuildSpec = {
  number: number;
  result: string;
  duration: number;
  /** undefined → no test report for this build. */
  cases?: Array<[CaseSpec, Status, { age?: number }?]>;
};

const specs: BuildSpec[] = [
  {
    number: 48,
    result: "UNSTABLE",
    duration: 9 * 60_000 + 12_000,
    cases: [
      [CHECKOUT, "FAILED", { age: 2 }],
      [PAYMENT, "FAILED"],
      [CONFIG, "FAILED"],
      [EXPORT, "SKIPPED"],
      ...PASSING.map((spec): [CaseSpec, Status] => [spec, "PASSED"])
    ]
  },
  {
    number: 47,
    result: "UNSTABLE",
    duration: 8 * 60_000 + 40_000,
    cases: [
      [CHECKOUT, "FAILED", { age: 1 }],
      [PAYMENT, "PASSED"],
      // Duplicate identity: two cases share suite/class/name, so the outcome is ambiguous.
      [CONFIG, "PASSED"],
      [CONFIG, "FAILED"],
      ...PASSING.map((spec): [CaseSpec, Status] => [spec, "PASSED"])
    ]
  },
  { number: 46, result: "ABORTED", duration: 2 * 60_000 },
  {
    number: 45,
    result: "SUCCESS",
    duration: 8 * 60_000 + 5_000,
    cases: [
      [CHECKOUT, "PASSED"],
      [PAYMENT, "FAILED"],
      [CONFIG, "PASSED"],
      [EXPORT, "PASSED"],
      ...PASSING.map((spec): [CaseSpec, Status] => [spec, "PASSED"])
    ]
  },
  {
    number: 44,
    result: "SUCCESS",
    duration: 7 * 60_000 + 51_000,
    cases: [
      [CHECKOUT, "PASSED"],
      [PAYMENT, "PASSED"],
      [CONFIG, "PASSED"],
      [EXPORT, "PASSED"],
      ...PASSING.map((spec): [CaseSpec, Status] => [spec, "PASSED"])
    ]
  },
  {
    number: 43,
    result: "FAILURE",
    duration: 10 * 60_000 + 30_000,
    cases: [
      [CHECKOUT, "PASSED"],
      [PAYMENT, "FAILED"],
      [CONFIG, "PASSED"],
      ...PASSING.map((spec): [CaseSpec, Status] => [spec, "PASSED"])
    ]
  }
];

function report(cases: NonNullable<BuildSpec["cases"]>): JenkinsTestReport {
  const bySuite = new Map<string, Array<Record<string, unknown>>>();
  for (const [spec, status, extra] of cases) {
    const list = bySuite.get(spec.suite) ?? [];
    list.push({ name: spec.name, className: spec.className, status, ...extra });
    bySuite.set(spec.suite, list);
  }
  return {
    suites: [...bySuite.entries()].map(([name, list]) => ({ name, cases: list }))
  } as JenkinsTestReport;
}

const observations: HistoryBuild[] = specs.map((spec, index) => {
  const build: JenkinsBuild = {
    number: spec.number,
    url: `${jobUrl}${spec.number}/`,
    result: spec.result,
    building: false,
    timestamp: now - (index + 1) * 5 * HOUR,
    duration: spec.duration
  };
  return {
    build,
    report: spec.cases
      ? normalizeHistoryReport(report(spec.cases))
      : { status: "unavailable", cases: [], message: "No test report published." }
  };
});

function evidenceFor(selectedIndex: number): Record<string, FailureEvidence> {
  const selected = observations[selectedIndex];
  const previous = observations[selectedIndex + 1]?.report;
  const previousOutcomes = new Map(
    previous?.status === "available" ? previous.cases.map((test) => [test.key, test.outcome]) : []
  );
  const evidence: Record<string, FailureEvidence> = {};
  for (const test of selected.report.cases) {
    const value = failureEvidence(test, selected.build.number, previousOutcomes.get(test.key));
    if (value) evidence[test.key] = value;
  }
  return evidence;
}

const tests = analyzeTests(observations);
const checkoutKey = tests.find((test) => test.name === CHECKOUT.name)?.key ?? "";
const paymentKey = tests.find((test) => test.name === PAYMENT.name)?.key ?? "";

const loaded: HistoryViewModel = {
  ...emptyHistory(),
  revision: 7,
  status: "partial",
  jobUrl,
  count: 20,
  selectedBuild: 48,
  builds: observations.map(({ build, report }) => ({
    build,
    report: { status: report.status, message: report.message, truncated: report.truncated }
  })),
  tests,
  evidence: evidenceFor(0),
  baseline: {
    status: "available",
    automatic: true,
    jobUrl: "https://jenkins.example.com/job/web-app/job/main/",
    label: "main",
    build: {
      number: 212,
      url: "https://jenkins.example.com/job/web-app/job/main/212/",
      result: "UNSTABLE",
      timestamp: now - 6 * HOUR,
      duration: 8 * 60_000
    }
  },
  baselineOutcomes: { [checkoutKey]: "passed", [paymentKey]: "failed" }
};

const manyTests: HistoryViewModel = {
  ...loaded,
  tests: [
    ...tests,
    ...Array.from({ length: 70 }, (_, index) => ({
      ...tests[tests.length - 1],
      key: `synthetic-${index}`,
      name: `synthetic generated case number ${index + 1}`
    }))
  ]
};

export const jobHistoryScenarios: Record<string, HistoryViewModel> = {
  loaded,
  manyTests,
  customBaselineError: {
    ...loaded,
    baseline: {
      status: "error",
      custom: true,
      jobUrl: "https://jenkins.example.com/job/web-app/job/release%252F2.x/",
      message: "Jenkins returned 404 for the baseline job."
    },
    baselineOutcomes: undefined
  },
  resolvingBaseline: { ...loaded, baseline: undefined, baselineOutcomes: undefined },
  refreshing: { ...loaded, status: "loading" },
  loading: { ...emptyHistory(), revision: 2, status: "loading", jobUrl },
  runningBuild: {
    ...emptyHistory(),
    revision: 2,
    status: "paused",
    pausedReason: "building",
    jobUrl
  },
  hidden: { ...emptyHistory(), revision: 3, status: "paused", pausedReason: "hidden", jobUrl },
  unavailable: {
    ...emptyHistory(),
    revision: 4,
    status: "unavailable",
    jobUrl,
    message: "No completed builds in the last 20."
  },
  error: {
    ...emptyHistory(),
    revision: 4,
    status: "error",
    jobUrl,
    message: "Error: Jenkins responded with 503 Service Unavailable"
  },
  notLoaded: { ...emptyHistory(), revision: 1, status: "idle", jobUrl }
};
