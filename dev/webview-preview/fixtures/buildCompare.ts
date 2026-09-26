import type { BuildCompareViewModel } from "../../../src/panels/buildCompare/shared/BuildCompareContracts";

const regression: BuildCompareViewModel = {
  title: "Compare web-app » main #1481 with #1482",
  baseline: {
    roleLabel: "Baseline",
    displayName: "#1481",
    buildUrl: "https://jenkins.example.com/job/web-app/job/main/1481/",
    resultLabel: "Success",
    resultClass: "success",
    durationLabel: "4m 21s",
    timestampLabel: "Sep 25, 2026, 5:40 PM"
  },
  target: {
    roleLabel: "Target",
    displayName: "#1482",
    buildUrl: "https://jenkins.example.com/job/web-app/job/main/1482/",
    resultLabel: "Failed",
    resultClass: "failure",
    durationLabel: "4m 52s",
    timestampLabel: "Sep 26, 2026, 9:14 AM"
  },
  tests: {
    status: "available",
    summaryLabel: "2 new failures, 1 new pass",
    baselineSummaryLabel: "920 passed, 6 skipped",
    targetSummaryLabel: "2 failed, 918 passed, 6 skipped",
    newFailures: [
      {
        key: "a",
        name: "applies discount codes",
        className: "checkout.payment",
        baselineStatusLabel: "Passed",
        targetStatusLabel: "Failed",
        baselineStatusTone: "passed",
        targetStatusTone: "failed",
        baselineDurationLabel: "10ms",
        targetDurationLabel: "12ms"
      },
      {
        key: "b",
        name: "rejects expired cards",
        className: "checkout.payment",
        baselineStatusLabel: "Passed",
        targetStatusLabel: "Failed",
        baselineStatusTone: "passed",
        targetStatusTone: "failed",
        baselineDurationLabel: "3ms",
        targetDurationLabel: "4ms"
      }
    ],
    stillFailing: [],
    newPasses: [
      {
        key: "c",
        name: "retries flaky webhook",
        className: "integrations.webhooks",
        baselineStatusLabel: "Failed",
        targetStatusLabel: "Passed",
        baselineStatusTone: "failed",
        targetStatusTone: "passed"
      }
    ],
    addedTests: [],
    removedTests: [],
    otherChangesCount: 0,
    unchangedCount: 917
  },
  parameters: {
    status: "available",
    summaryLabel: "2 changed",
    items: [
      { name: "NODE_VERSION", changeType: "changed", baselineValue: "22", targetValue: "24" },
      { name: "SKIP_E2E", changeType: "added", targetValue: "true" }
    ],
    unchangedCount: 4
  },
  changesets: {
    status: "available",
    summaryLabel: "2 commits in target",
    baselineItems: [],
    targetItems: [
      {
        message: "Apply stacked discount codes before tax",
        author: "Jane Doe",
        commitId: "4f2c9a1b7e3d"
      },
      { message: "Validate card expiry on the client", author: "Sam Lee", commitId: "9ab31c0d2e11" }
    ]
  },
  stages: {
    status: "available",
    summaryLabel: "1 regression, 2 skipped",
    items: [
      {
        key: "checkout",
        name: "Checkout",
        changeType: "matched",
        baselineStatusLabel: "Success",
        targetStatusLabel: "Success",
        baselineStatusClass: "success",
        targetStatusClass: "success",
        baselineDurationLabel: "5s",
        targetDurationLabel: "4s",
        deltaLabel: "-1s",
        deltaDirection: "faster"
      },
      {
        key: "build",
        name: "Build",
        changeType: "matched",
        baselineStatusLabel: "Success",
        targetStatusLabel: "Success",
        baselineStatusClass: "success",
        targetStatusClass: "success",
        baselineDurationLabel: "41s",
        targetDurationLabel: "48s",
        deltaLabel: "+7s",
        deltaDirection: "slower"
      },
      {
        key: "tests",
        name: "Tests",
        changeType: "matched",
        baselineStatusLabel: "Success",
        targetStatusLabel: "Failed",
        baselineStatusClass: "success",
        targetStatusClass: "failure",
        baselineDurationLabel: "2m 10s",
        targetDurationLabel: "2m 34s",
        deltaLabel: "+24s",
        deltaDirection: "slower"
      },
      {
        key: "smoke",
        name: "Smoke tests",
        changeType: "added",
        targetStatusLabel: "Skipped",
        targetStatusClass: "neutral"
      },
      {
        key: "legacy",
        name: "Legacy bundle",
        changeType: "removed",
        baselineStatusLabel: "Success",
        baselineStatusClass: "success",
        baselineDurationLabel: "12s"
      }
    ]
  },
  console: {
    status: "available",
    summaryLabel: "Diverges at line 19",
    divergenceLineLabel: "Line 19",
    baselineLines: [
      { lineNumber: 17, text: "[Unit tests] + npm run test:unit", highlight: false },
      {
        lineNumber: 18,
        text: "[Unit tests]  ✓ src/cart/cartTotals.test.ts (14 tests) 40ms",
        highlight: false
      },
      {
        lineNumber: 19,
        text: "[Unit tests]  ✓ src/checkout/payment.test.ts (22 tests) 51ms",
        highlight: true
      },
      { lineNumber: 20, text: "[Lint] + npm run check", highlight: false }
    ],
    targetLines: [
      { lineNumber: 17, text: "[Unit tests] + npm run test:unit", highlight: false },
      {
        lineNumber: 18,
        text: "[Unit tests]  ✓ src/cart/cartTotals.test.ts (14 tests) 42ms",
        highlight: false
      },
      {
        lineNumber: 19,
        text: "[Unit tests]  ✗ src/checkout/payment.test.ts > applies discount codes",
        highlight: true
      },
      {
        lineNumber: 20,
        text: "[Unit tests]    AssertionError: expected 90 to equal 85",
        highlight: false
      }
    ]
  },
  errors: []
};

const identical: BuildCompareViewModel = {
  ...regression,
  target: { ...regression.target, resultLabel: "Success", resultClass: "success" },
  tests: {
    ...regression.tests,
    status: "identical",
    summaryLabel: "No test changes",
    newFailures: [],
    newPasses: [],
    unchangedCount: 926
  },
  parameters: {
    ...regression.parameters,
    status: "identical",
    summaryLabel: "Identical",
    items: []
  },
  changesets: {
    ...regression.changesets,
    status: "empty",
    summaryLabel: "No commits",
    targetItems: []
  },
  stages: {
    ...regression.stages,
    status: "unavailable",
    summaryLabel: "Not a pipeline",
    items: []
  },
  console: {
    ...regression.console,
    status: "tooLarge",
    summaryLabel: "Console too large to compare",
    detail: "Both console logs exceed the 5 MB comparison limit.",
    baselineLines: [],
    targetLines: []
  }
};

export const buildCompareScenarios: Record<string, BuildCompareViewModel> = {
  regression,
  identical
};
