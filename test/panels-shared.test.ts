import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PanelLoadTracker, bindEnvironmentRefresh } from "../src/panels/shared/PanelRuntimeHelpers";
import {
  buildOccurrenceKey,
  buildTestCaseId,
  buildTestCaseKey,
  forEachNormalizedTestCase,
  formatTestCaseSubtitle,
  normalizeTestCaseBase,
  resolveTestCaseName
} from "../src/panels/shared/TestCaseViewModel";
import {
  EMPTY_TEST_RESULTS_LABEL,
  formatAvailableTestReportCountsSummary,
  formatTestDuration,
  formatTestReportCountsSummary
} from "../src/panels/shared/TestReportFormatters";

describe("TestReportFormatters", () => {
  it("formats durations across invalid, millisecond, second, and compact ranges", () => {
    assert.equal(formatTestDuration(undefined), undefined);
    assert.equal(formatTestDuration(Number.NaN), undefined);
    assert.equal(formatTestDuration(-1), undefined);
    assert.equal(formatTestDuration(0.123), "123 ms");
    assert.equal(formatTestDuration(1), "1 s");
    assert.equal(formatTestDuration(1.25), "1.3 s");
    assert.equal(formatTestDuration(61), "1m 1s");
  });

  it("formats count summaries for empty, complete, and partial count inputs", () => {
    assert.equal(formatTestReportCountsSummary({}), EMPTY_TEST_RESULTS_LABEL);
    assert.equal(
      formatTestReportCountsSummary({ failed: 0, total: 0, skipped: 0 }),
      EMPTY_TEST_RESULTS_LABEL
    );
    assert.equal(formatTestReportCountsSummary({ failed: 2, total: 10 }), "Failed 2 / 10");
    assert.equal(
      formatTestReportCountsSummary({ failed: 2, total: 10, skipped: 3 }),
      "Failed 2 / 10 • Skipped 3"
    );
    assert.equal(formatTestReportCountsSummary({ total: 7 }), "Total 7 tests");
    assert.equal(formatTestReportCountsSummary({ failed: 4 }), "Failed 4 tests");
    assert.equal(formatTestReportCountsSummary({ skipped: 5 }), "Skipped 5 tests");
    assert.equal(
      formatAvailableTestReportCountsSummary({ failCount: 1, totalCount: 9, skipCount: 2 }),
      "Failed 1 / 9 • Skipped 2"
    );
  });
});

describe("PanelLoadTracker", () => {
  it("posts loading changes only at lifecycle boundaries", () => {
    const posted: boolean[] = [];
    const tracker = new PanelLoadTracker((value) => posted.push(value));

    tracker.beginLoading();
    tracker.beginLoading();
    tracker.endLoading();
    assert.deepEqual(posted, [true]);

    tracker.endLoading();
    tracker.endLoading();
    assert.deepEqual(posted, [true, false]);
  });

  it("resets outstanding loads and tracks current load tokens", () => {
    const posted: boolean[] = [];
    const tracker = new PanelLoadTracker((value) => posted.push(value));

    const first = tracker.nextToken();
    const second = tracker.nextToken();

    assert.equal(tracker.currentToken, second);
    assert.equal(tracker.isCurrent(first), false);
    assert.equal(tracker.isCurrent(second), true);

    tracker.resetLoadingRequests();
    tracker.beginLoading();
    tracker.beginLoading();
    tracker.resetLoadingRequests();
    tracker.resetLoadingRequests();
    tracker.beginLoading();

    assert.deepEqual(posted, [true, false, true]);
  });
});

describe("bindEnvironmentRefresh", () => {
  it("routes rejected refresh callbacks to the refresh error handler", async () => {
    let listener: ((environmentId?: string) => void) | undefined;
    const refreshError = new Error("refresh failed");
    const handledErrors: Array<{ error: unknown; environmentId?: string }> = [];

    const subscription = bindEnvironmentRefresh(
      undefined,
      {
        onDidRefreshEnvironment: (nextListener) => {
          listener = nextListener;
          return { dispose() {} };
        }
      },
      async () => {
        throw refreshError;
      },
      (error, environmentId) => {
        handledErrors.push({ error, environmentId });
      }
    );

    assert.ok(subscription);
    listener?.("env-a");
    await Promise.resolve();

    assert.deepEqual(handledErrors, [{ error: refreshError, environmentId: "env-a" }]);
  });
});

describe("TestCaseViewModel", () => {
  it("builds stable keys, ids, occurrence keys, and subtitles", () => {
    assert.equal(
      buildTestCaseKey("com.example.Tests", "unit", "runs"),
      "com.example.Tests::unit::runs"
    );
    assert.equal(
      buildTestCaseId("com.example.Tests", "unit", "runs", 2, 3),
      "com.example.Tests::unit::runs::2::3"
    );
    assert.equal(
      buildOccurrenceKey("com.example.Tests::unit::runs", 4),
      "com.example.Tests::unit::runs::4"
    );
    assert.equal(formatTestCaseSubtitle("com.example.Tests", "unit"), "com.example.Tests • unit");
    assert.equal(formatTestCaseSubtitle(undefined, undefined), "Unnamed suite");
  });

  it("normalizes names, class names, statuses, durations, and suite iteration context", () => {
    const report = {
      suites: [
        {
          name: " suite-a ",
          cases: [
            {
              name: " runs ",
              className: " com.example.Tests ",
              status: "REGRESSION",
              duration: 1.25
            },
            { name: " ", className: " com.example.Fallback ", status: "SKIPPED" }
          ]
        }
      ]
    };
    const seen: Array<ReturnType<typeof normalizeTestCaseBase>> = [];

    forEachNormalizedTestCase(report, (testCase, context) => {
      assert.deepEqual(context, { suiteName: "suite-a", suiteIndex: 0, caseIndex: seen.length });
      seen.push(normalizeTestCaseBase(testCase, context.suiteName, { fallbackToClassName: true }));
    });

    assert.deepEqual(seen, [
      {
        key: "com.example.Tests::suite-a::runs",
        name: "runs",
        className: "com.example.Tests",
        suiteName: "suite-a",
        status: "failed",
        statusLabel: "Failed",
        durationLabel: "1.3 s"
      },
      {
        key: "com.example.Fallback::suite-a::com.example.Fallback",
        name: "com.example.Fallback",
        className: "com.example.Fallback",
        suiteName: "suite-a",
        status: "skipped",
        statusLabel: "Skipped",
        durationLabel: undefined
      }
    ]);
  });

  it("returns undefined for unnamed cases unless a fallback is requested", () => {
    const unnamed = { name: " ", className: " " };

    assert.equal(resolveTestCaseName(unnamed), undefined);
    assert.equal(
      resolveTestCaseName(unnamed, { fallbackToClassName: true, unnamedLabel: "Unnamed" }),
      "Unnamed"
    );
    assert.equal(normalizeTestCaseBase(unnamed, undefined), undefined);
    assert.deepEqual(normalizeTestCaseBase(unnamed, undefined, { fallbackToClassName: true }), {
      key: "::::Unnamed test",
      name: "Unnamed test",
      className: undefined,
      suiteName: undefined,
      status: "other",
      statusLabel: "Other",
      durationLabel: undefined
    });
  });
});
