import type {
  BuildDetailsViewModel,
  PipelineStageStepViewModel,
  PipelineStageViewModel
} from "../../../src/panels/buildDetails/shared/BuildDetailsContracts";

function step(
  key: string,
  name: string,
  statusClass: string,
  statusLabel: string,
  durationLabel: string
): PipelineStageStepViewModel {
  return {
    key,
    nodeId: key,
    logTarget: { key, kind: "step", name, nodeId: key },
    name,
    statusLabel,
    statusClass,
    durationLabel,
    canOpenLog: true
  };
}

function stage(
  key: string,
  name: string,
  statusClass: string,
  statusLabel: string,
  durationLabel: string,
  durationMs: number,
  steps: PipelineStageStepViewModel[] = [],
  parallelBranches: PipelineStageViewModel[] = []
): PipelineStageViewModel {
  return {
    key,
    nodeId: key,
    logTarget: { key, kind: "stage", name, nodeId: key },
    name,
    statusLabel,
    statusClass,
    durationLabel,
    durationMs,
    canRestartFromStage: statusClass !== "running",
    hasSteps: steps.length > 0,
    stepsAll: steps,
    stepsFailedOnly: steps.filter((item) => item.statusClass === "failure"),
    parallelBranches,
    canOpenLog: true
  };
}

const failedStages: PipelineStageViewModel[] = [
  stage("6", "Checkout", "success", "Success", "4s", 4_000, [
    step("7", "git", "success", "Success", "3.2s")
  ]),
  stage("12", "Install dependencies", "success", "Success", "1m 12s", 72_000, [
    step("13", "npm ci", "success", "Success", "1m 10s")
  ]),
  stage("20", "Build", "success", "Success", "48s", 48_000, [
    step("21", "npm run compile", "success", "Success", "46s")
  ]),
  stage(
    "30",
    "Tests",
    "failure",
    "Failed",
    "2m 34s",
    154_000,
    [],
    [
      stage("31", "Unit tests", "failure", "Failed", "2m 34s", 154_000, [
        step("32", "npm run test:unit", "failure", "Failed", "2m 30s"),
        step("33", "junit", "success", "Success", "1.1s")
      ]),
      stage("40", "Lint", "success", "Success", "22s", 22_000, [
        step("41", "npm run check", "success", "Success", "21s")
      ]),
      stage("50", "Integration", "unstable", "Unstable", "1m 58s", 118_000, [
        step("51", "npm run test:integration", "unstable", "Unstable", "1m 55s")
      ])
    ]
  ),
  stage("60", "Package", "neutral", "Skipped", "0ms", 0),
  stage("70", "Deploy to staging", "neutral", "Skipped", "0ms", 0)
];

const consoleText = [
  "Started by user Jane Doe",
  "Obtained Jenkinsfile from git https://github.com/example/web-app.git",
  "[Pipeline] Start of Pipeline",
  "[Pipeline] node",
  "Running on build-agent-03 in /var/lib/jenkins/workspace/web-app_main",
  "[Pipeline] { (Checkout)",
  "Fetching changes from the remote Git repository",
  "Checking out Revision 4f2c9a1b7e3d (refs/remotes/origin/main)",
  "[Pipeline] { (Install dependencies)",
  "+ npm ci",
  "added 1284 packages in 68s",
  "[Pipeline] { (Build)",
  "+ npm run compile",
  "> web-app@2.14.0 compile",
  "> tsc -p ./",
  "[Pipeline] { (Tests)",
  "[Pipeline] parallel",
  "[Unit tests] + npm run test:unit",
  "[Unit tests]  ✓ src/cart/cartTotals.test.ts (14 tests) 42ms",
  "[Unit tests]  ✗ src/checkout/payment.test.ts > applies discount codes",
  "[Unit tests]    AssertionError: expected 90 to equal 85",
  "[Unit tests]     at src/checkout/payment.test.ts:48:22",
  "[Unit tests]  ✗ src/checkout/payment.test.ts > rejects expired cards",
  "[Unit tests]    TypeError: Cannot read properties of undefined (reading 'expiry')",
  "[Unit tests]     at validateCard (src/checkout/validateCard.ts:17:31)",
  "[Lint] + npm run check",
  "[Lint] Checked 412 files in 1.8s. No fixes applied.",
  "[Integration] WARNING: 2 tests were retried before passing",
  "[Unit tests] Test Files  1 failed | 63 passed (64)",
  "[Unit tests]      Tests  2 failed | 918 passed | 6 skipped (926)",
  "script returned exit code 1",
  "[Pipeline] // parallel",
  'Stage "Package" skipped due to earlier failure(s)',
  'Stage "Deploy to staging" skipped due to earlier failure(s)',
  "[Pipeline] End of Pipeline",
  "ERROR: script returned exit code 1",
  "Finished: FAILURE"
].join("\n");

const failed: BuildDetailsViewModel = {
  displayName: "web-app » main #1482",
  buildUrl: "https://jenkins.example.com/job/web-app/job/main/1482/",
  resultLabel: "Failed",
  resultClass: "failure",
  durationLabel: "4m 52s",
  timestampLabel: "Sep 26, 2026, 9:14 AM",
  culpritsLabel: "Jane Doe, Sam Lee",
  pipelineStagesLoading: false,
  pipelineStages: failedStages,
  pipelineNodeLog: { text: "", truncated: false, loading: false },
  testState: {
    summary: {
      totalCount: 926,
      failedCount: 2,
      skippedCount: 6,
      passedCount: 918,
      summaryLabel: "2 failed, 918 passed, 6 skipped",
      hasAnyResults: true,
      hasDetailedResults: true,
      detailsUnavailable: false,
      logsIncluded: false,
      canLoadLogs: true
    },
    results: {
      loading: false,
      items: [
        {
          id: "t1",
          name: "applies discount codes",
          className: "checkout.payment",
          suiteName: "src/checkout/payment.test.ts",
          status: "failed",
          statusLabel: "Failed",
          durationLabel: "12ms",
          errorDetails: "AssertionError: expected 90 to equal 85",
          errorStackTrace:
            "AssertionError: expected 90 to equal 85\n    at src/checkout/payment.test.ts:48:22\n    at runTest (node_modules/vitest/dist/runner.js:1102:9)",
          canOpenSource: true
        },
        {
          id: "t2",
          name: "rejects expired cards",
          className: "checkout.payment",
          suiteName: "src/checkout/payment.test.ts",
          status: "failed",
          statusLabel: "Failed",
          durationLabel: "4ms",
          errorDetails: "TypeError: Cannot read properties of undefined (reading 'expiry')",
          errorStackTrace:
            "TypeError: Cannot read properties of undefined (reading 'expiry')\n    at validateCard (src/checkout/validateCard.ts:17:31)",
          canOpenSource: true
        },
        {
          id: "t3",
          name: "computes totals with tax",
          className: "cart.cartTotals",
          suiteName: "src/cart/cartTotals.test.ts",
          status: "passed",
          statusLabel: "Passed",
          durationLabel: "3ms",
          canOpenSource: true
        },
        {
          id: "t4",
          name: "handles currency rounding for JPY",
          className: "cart.cartTotals",
          suiteName: "src/cart/cartTotals.test.ts",
          status: "skipped",
          statusLabel: "Skipped",
          canOpenSource: false
        }
      ]
    }
  },
  coverageState: {
    status: "available",
    showTab: true,
    projectCoverage: "82.4%",
    modifiedFilesCoverage: "71.0%",
    modifiedLinesCoverage: "64.3%",
    overallQualityGateStatusLabel: "Unstable",
    overallQualityGateStatusClass: "unstable",
    qualityGates: [
      {
        name: "Line coverage",
        statusLabel: "Passed",
        statusClass: "success",
        thresholdLabel: "≥ 80%",
        valueLabel: "82.4%"
      },
      {
        name: "Modified lines",
        statusLabel: "Unstable",
        statusClass: "unstable",
        thresholdLabel: "≥ 70%",
        valueLabel: "64.3%"
      }
    ],
    modifiedFiles: [
      { path: "src/checkout/payment.ts", coveredCount: 41, missedCount: 9, partialCount: 3 },
      { path: "src/checkout/validateCard.ts", coveredCount: 12, missedCount: 6, partialCount: 1 }
    ],
    summaryOnly: false
  },
  insights: {
    changelogItems: [
      {
        message: "Apply stacked discount codes before tax",
        author: "Jane Doe",
        commitId: "4f2c9a1b7e3d"
      },
      { message: "Validate card expiry on the client", author: "Sam Lee", commitId: "9ab31c0d2e11" }
    ],
    changelogOverflow: 0,
    testSummaryLabel: "2 failed, 918 passed, 6 skipped",
    hasFailedTests: true,
    artifacts: [
      { name: "junit.xml", fileName: "junit.xml", relativePath: "reports/junit.xml" },
      {
        name: "coverage-summary.json",
        fileName: "coverage-summary.json",
        relativePath: "coverage/coverage-summary.json"
      },
      {
        name: "web-app-2.14.0.tgz",
        fileName: "web-app-2.14.0.tgz",
        relativePath: "dist/web-app-2.14.0.tgz"
      }
    ],
    artifactsOverflow: 0
  },
  diagnostics: {
    status: "available",
    errorCount: 2,
    warningCount: 1,
    informationCount: 0,
    resolvedCount: 2,
    unresolvedCount: 1,
    omittedCount: 0,
    items: [
      {
        severity: "error",
        message: "AssertionError: expected 90 to equal 85",
        locationLabel: "src/checkout/payment.test.ts:48:22",
        source: "vitest",
        targetId: "d1"
      },
      {
        severity: "error",
        message: "TypeError: Cannot read properties of undefined (reading 'expiry')",
        locationLabel: "src/checkout/validateCard.ts:17:31",
        source: "vitest",
        targetId: "d2"
      },
      {
        severity: "warning",
        message: "2 tests were retried before passing",
        source: "integration"
      }
    ],
    warnings: [],
    consoleReferences: []
  },
  pendingInputs: [],
  consoleText,
  consoleTruncated: false,
  consoleMaxChars: 200_000,
  errors: [],
  followLog: false
};

const running: BuildDetailsViewModel = {
  ...failed,
  displayName: "web-app » main #1483",
  resultLabel: "Running",
  resultClass: "running",
  durationLabel: "1m 40s",
  timestampLabel: "Sep 26, 2026, 10:02 AM",
  pipelineStages: [
    failedStages[0],
    failedStages[1],
    stage("20", "Build", "running", "Running", "18s", 18_000, [
      step("21", "npm run compile", "running", "Running", "16s")
    ])
  ],
  testState: {
    summary: {
      totalCount: 0,
      failedCount: 0,
      skippedCount: 0,
      passedCount: 0,
      summaryLabel: "No test results",
      hasAnyResults: false,
      hasDetailedResults: false,
      detailsUnavailable: false,
      logsIncluded: false,
      canLoadLogs: false
    },
    results: { items: [], loading: false }
  },
  coverageState: {
    status: "idle",
    showTab: false,
    qualityGates: [],
    modifiedFiles: [],
    summaryOnly: false
  },
  insights: {
    changelogItems: failed.insights.changelogItems,
    changelogOverflow: 0,
    testSummaryLabel: "",
    hasFailedTests: false,
    artifacts: [],
    artifactsOverflow: 0
  },
  diagnostics: undefined,
  consoleText: consoleText.split("\n").slice(0, 15).join("\n"),
  followLog: true
};

const awaitingInput: BuildDetailsViewModel = {
  ...running,
  displayName: "web-app » release #212",
  pendingInputs: [
    {
      id: "deploy-prod",
      message: "Deploy web-app 2.14.0 to production?",
      submitterLabel: "Submitter: release-managers",
      parametersLabel: "Parameters: REGION (Choice), NOTIFY (Boolean)",
      parameters: [
        {
          name: "REGION",
          kind: "choice",
          description: "Target region",
          choices: ["us-east-1", "eu-west-1"],
          defaultValue: "us-east-1"
        },
        { name: "NOTIFY", kind: "boolean", description: "Post to #releases", defaultValue: true }
      ]
    }
  ]
};

const success: BuildDetailsViewModel = {
  ...failed,
  displayName: "web-app » main #1481",
  resultLabel: "Success",
  resultClass: "success",
  culpritsLabel: "Jane Doe",
  pipelineStages: failedStages.map((item) => ({
    ...item,
    statusClass: "success",
    statusLabel: "Success",
    parallelBranches: item.parallelBranches.map((branch) => ({
      ...branch,
      statusClass: "success",
      statusLabel: "Success"
    }))
  })),
  testState: {
    summary: {
      ...failed.testState.summary,
      failedCount: 0,
      passedCount: 920,
      summaryLabel: "920 passed, 6 skipped"
    },
    results: {
      loading: false,
      items: failed.testState.results.items.filter((item) => item.status !== "failed")
    }
  },
  insights: {
    ...failed.insights,
    hasFailedTests: false,
    testSummaryLabel: "920 passed, 6 skipped"
  },
  diagnostics: undefined,
  consoleText: `${consoleText.split("\n").slice(0, 18).join("\n")}\nFinished: SUCCESS`
};

const freestyle: BuildDetailsViewModel = {
  ...failed,
  displayName: "nightly-cleanup #88",
  pipelineStages: [],
  testState: running.testState,
  coverageState: running.coverageState,
  insights: { ...failed.insights, hasFailedTests: false, artifacts: [], changelogItems: [] },
  diagnostics: undefined,
  culpritsLabel: "",
  errors: ["Unable to load test report: HTTP 404 Not Found"]
};

// A clean freestyle build that reports nothing beyond its result, so the
// Overview tab shows its fallback summary card.
const minimal: BuildDetailsViewModel = {
  ...freestyle,
  displayName: "nightly-cleanup #89",
  resultLabel: "Success",
  resultClass: "success",
  insights: { ...running.insights, changelogItems: [] },
  coverageState: { ...running.coverageState, status: "disabled" },
  consoleText: "Started by timer\nCleaning old workspaces\nFinished: SUCCESS",
  errors: []
};

export const buildDetailsScenarios: Record<string, BuildDetailsViewModel> = {
  failed,
  running,
  awaitingInput,
  success,
  freestyle,
  minimal
};
