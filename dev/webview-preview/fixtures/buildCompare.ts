import type { BuildCompareViewModel } from "../../../src/panels/buildCompare/shared/BuildCompareContracts";

const regression: BuildCompareViewModel = {
  title: "Compare web-app » main #1481 with #1482",
  baseline: {
    roleLabel: "Baseline",
    displayName: "web-app » main #1481",
    buildNumberLabel: "#1481",
    jobDisplayName: "web-app » main",
    buildUrl: "https://jenkins.example.com/job/web-app/job/main/1481/",
    resultLabel: "Success",
    resultClass: "success",
    durationLabel: "4m 21s",
    timestampLabel: "Sep 25, 2026, 5:40 PM"
  },
  target: {
    roleLabel: "Target",
    displayName: "web-app » main #1482",
    buildNumberLabel: "#1482",
    jobDisplayName: "web-app » main",
    buildUrl: "https://jenkins.example.com/job/web-app/job/main/1482/",
    resultLabel: "Failed",
    resultClass: "failure",
    durationLabel: "4m 52s",
    timestampLabel: "Sep 26, 2026, 9:14 AM"
  },
  tests: {
    status: "available",
    summaryLabel: "New failures 3 · Still failing 0 · Newly passing 1 · 1 ambiguous",
    baselineSummaryLabel: "920 passed, 6 skipped",
    targetSummaryLabel: "3 failed, 918 passed, 6 skipped",
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
      },
      {
        key: "d",
        name: "rounds split tenders to the nearest cent when currency has no minor unit",
        className: "checkout.payment.SplitTenderRoundingTest",
        suiteName: "checkout-integration",
        targetStatusLabel: "Failed",
        targetStatusTone: "failed",
        targetDurationLabel: "31ms",
        addedInTarget: true
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
    otherChanges: [
      {
        key: "e",
        name: "renders the legacy receipt template",
        className: "receipts.LegacyTemplateTest",
        baselineStatusLabel: "Failed",
        targetStatusLabel: "Skipped",
        baselineStatusTone: "failed",
        targetStatusTone: "skipped"
      }
    ],
    ambiguousTests: [
      {
        key: "f",
        name: "handles concurrent cart updates",
        className: "cart.CartConcurrencyTest",
        baselineStatusLabels: ["Failed", "Passed"],
        targetStatusLabels: ["Passed"]
      }
    ],
    unchangedCount: 917
  },
  parameters: {
    status: "available",
    summaryLabel: "2 changed parameters",
    detail: "4 parameters matched across both builds.",
    items: [
      { name: "NODE_VERSION", changeType: "changed", baselineValue: "22", targetValue: "24" },
      { name: "SKIP_E2E", changeType: "added", targetValue: "true" }
    ],
    unchangedCount: 4
  },
  changesets: {
    status: "available",
    summaryLabel: "0 commits in baseline · 2 commits in target",
    detail:
      "Jenkins records each build's commits since the build before it, not the full difference between these two builds.",
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
    summaryLabel: "5 stage paths compared · 1 slower",
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
        deltaDirection: "faster",
        deltaSignificant: false
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
        deltaDirection: "slower",
        deltaSignificant: false
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
        deltaDirection: "slower",
        deltaSignificant: true
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
    summaryLabel: "First console divergence found",
    detail: "Compared up to 5 MB and 20,000 lines per build.",
    divergenceLineLabel: "First difference at line 19",
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
    status: "empty",
    summaryLabel: "No test changes",
    targetSummaryLabel: "920 passed, 6 skipped",
    newFailures: [],
    newPasses: [],
    otherChanges: [],
    ambiguousTests: [],
    unchangedCount: 926
  },
  parameters: {
    ...regression.parameters,
    status: "empty",
    summaryLabel: "No parameter differences",
    detail: "6 parameters matched across both builds.",
    items: []
  },
  changesets: {
    ...regression.changesets,
    status: "empty",
    summaryLabel: "No commits recorded for either build",
    detail: undefined,
    targetItems: []
  },
  stages: {
    ...regression.stages,
    status: "unavailable",
    summaryLabel: "Pipeline timing unavailable",
    detail: "Neither build has pipeline stage data.",
    items: []
  },
  console: {
    ...regression.console,
    status: "identical",
    summaryLabel: "Console output is identical",
    detail: "Compared in full.",
    divergenceLineLabel: undefined,
    baselineLines: [],
    targetLines: []
  }
};

/** Console past the scan limits: offers to open either build instead of a snippet. */
const consoleTooLarge: BuildCompareViewModel = {
  ...regression,
  console: {
    ...regression.console,
    status: "tooLarge",
    summaryLabel: "Logs too large for comparison",
    detail: "Comparison stops after 5 MB or 20,000 lines per build.",
    divergenceLineLabel: undefined,
    baselineLines: [],
    targetLines: []
  }
};

/** Hundreds of changed tests: exercises the search box and "Show more" paging. */
const manyTestChanges: BuildCompareViewModel = {
  ...regression,
  tests: {
    ...regression.tests,
    summaryLabel: "New failures 140 · Still failing 12 · Newly passing 1 · 1 ambiguous",
    targetSummaryLabel: "152 failed, 768 passed, 6 skipped",
    newFailures: Array.from({ length: 140 }, (_, index) => ({
      key: `generated-${index}`,
      name: `handles order variant ${index + 1}`,
      className: `checkout.variants.Variant${Math.floor(index / 20) + 1}Test`,
      suiteName: "checkout-variants",
      baselineStatusLabel: "Passed",
      targetStatusLabel: "Failed",
      baselineStatusTone: "passed" as const,
      targetStatusTone: "failed" as const
    })),
    stillFailing: Array.from({ length: 12 }, (_, index) => ({
      key: `still-${index}`,
      name: `syncs inventory shard ${index + 1}`,
      className: "inventory.ShardSyncTest",
      baselineStatusLabel: "Failed",
      targetStatusLabel: "Failed",
      baselineStatusTone: "failed" as const,
      targetStatusTone: "failed" as const
    }))
  }
};

/** A failed section: the detail shows once in the section, the top list only names it. */
const sectionError: BuildCompareViewModel = {
  ...regression,
  tests: {
    ...regression.tests,
    status: "error",
    summaryLabel: "Test comparison unavailable",
    detail: "Target test report: Request failed with status 500.",
    baselineSummaryLabel: "920 passed, 6 skipped",
    targetSummaryLabel: "Error",
    newFailures: [],
    stillFailing: [],
    newPasses: [],
    otherChanges: [],
    ambiguousTests: [],
    unchangedCount: 0
  },
  console: {
    ...regression.console,
    status: "error",
    summaryLabel: "Console comparison unavailable",
    detail: "Request failed with status 503.",
    divergenceLineLabel: undefined,
    baselineLines: [],
    targetLines: []
  }
};

const crossJob: BuildCompareViewModel = {
  ...regression,
  baseline: {
    ...regression.baseline,
    displayName: "web-app » release/2026.09 #312",
    buildNumberLabel: "#312",
    jobDisplayName: "web-app » release/2026.09",
    buildUrl: "https://jenkins.example.com/job/web-app/job/release%2F2026.09/312/"
  }
};

export const buildCompareScenarios: Record<string, BuildCompareViewModel> = {
  regression,
  identical,
  crossJob,
  consoleTooLarge,
  manyTestChanges,
  sectionError
};
