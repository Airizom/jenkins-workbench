import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  BuildDetailsCoverageStateViewModel,
  BuildTestsSummaryViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import {
  BuildDetailsErrors,
  hasLoadedBuildHeader,
  resolveBuildDetailsErrorMode
} from "../src/panels/buildDetails/webview/components/buildDetails/BuildDetailsErrors";
import { describeAwaitingInput } from "../src/panels/buildDetails/webview/components/buildDetails/hero/AwaitingInputBanner";
import { BuildStatusHero } from "../src/panels/buildDetails/webview/components/buildDetails/hero/BuildStatusHero";
import { CoverageGlanceCard } from "../src/panels/buildDetails/webview/components/buildDetails/overview/CoverageGlanceCard";

const EMPTY_TESTS: BuildTestsSummaryViewModel = {
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
};

function renderHero(overrides: Partial<Parameters<typeof BuildStatusHero>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(BuildStatusHero, {
      displayName: "web-app » release #212",
      resultLabel: "Running",
      resultClass: "running",
      durationLabel: "1m",
      timestampLabel: "today",
      culpritsLabel: "None",
      loading: false,
      isRunning: true,
      testsSummary: EMPTY_TESTS,
      stageCount: 0,
      onOpenBuild: () => undefined,
      ...overrides
    })
  );
}

describe("BuildStatusHero", () => {
  it("keeps the full title available and lets it wrap instead of collapsing", () => {
    const html = renderHero();
    assert.match(html, /<h1[^>]*class="[^"]*line-clamp-2[^"]*"[^>]*title="web-app » release #212"/);
    assert.doesNotMatch(html, /<h1[^>]*class="[^"]*\btruncate\b/);
  });

  it("shows a waiting-for-input status with a review action", () => {
    let reviewed = false;
    const html = renderHero({
      awaitingInput: { count: 1, message: "Deploy to production?" },
      onReviewInputs: () => {
        reviewed = true;
      }
    });

    assert.match(html, /id="detail-result"[^>]*>Waiting for input</);
    assert.match(html, /Build paused:/);
    assert.match(html, /Deploy to production\?/);
    assert.match(html, />Review</);
    assert.equal(reviewed, false);
  });

  it("omits the review action when the Inputs tab is already open", () => {
    const html = renderHero({ awaitingInput: { count: 2, message: "Deploy?" } });
    assert.doesNotMatch(html, />Review</);
    assert.equal(
      describeAwaitingInput({ count: 2, message: "Deploy?" }),
      "2 inputs are waiting for a response."
    );
  });
});

describe("BuildDetailsErrors", () => {
  it("reserves the blocking title for builds that never loaded", () => {
    assert.equal(resolveBuildDetailsErrorMode([], false), "none");
    assert.equal(resolveBuildDetailsErrorMode(["Build details: 404"], false), "blocking");
    assert.equal(resolveBuildDetailsErrorMode(["Pending inputs: 500"], true), "partial");
    assert.equal(
      hasLoadedBuildHeader({ resultLabel: "Unknown", timestampLabel: "Unknown" }),
      false
    );
    assert.equal(hasLoadedBuildHeader({ resultLabel: "Running", timestampLabel: "today" }), true);
  });

  it("lists section errors under a non-blocking heading once the build loaded", () => {
    const html = renderToStaticMarkup(
      createElement(BuildDetailsErrors, {
        errors: ["Pending inputs: HTTP 500"],
        buildLoaded: true,
        onRetry: () => undefined
      })
    );
    assert.match(html, /Some information couldn(’|'|&#x27;)t be loaded/);
    assert.doesNotMatch(html, /Unable to load build details/);
    assert.match(html, /<li>Pending inputs: HTTP 500<\/li>/);
    assert.match(html, /Retry/);
  });

  it("keeps the blocking title when nothing loaded", () => {
    const html = renderToStaticMarkup(
      createElement(BuildDetailsErrors, {
        errors: ["Build details: HTTP 404"],
        buildLoaded: false,
        onRetry: () => undefined
      })
    );
    assert.match(html, /Unable to load build details/);
  });
});

describe("CoverageGlanceCard", () => {
  const idle: BuildDetailsCoverageStateViewModel = {
    status: "idle",
    showTab: true,
    qualityGates: [],
    modifiedFiles: [],
    summaryOnly: false
  };

  it("explains that coverage waits for completion on running builds", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageGlanceCard, { coverageState: idle, isRunning: true })
    );
    assert.match(html, /Coverage is available after the build completes\./);
    assert.doesNotMatch(html, /Loading coverage/);
  });

  it("links to coverage details with a matching accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageGlanceCard, { coverageState: idle, onShowTests: () => undefined })
    );
    assert.match(html, /Loading coverage results/);
    assert.match(html, />View coverage details</);
    assert.doesNotMatch(html, /aria-label="Open the Tests tab/);
  });
});
