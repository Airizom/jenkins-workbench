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
import { BuildDetailsMetaFields } from "../src/panels/buildDetails/webview/components/buildDetails/BuildDetailsMetaFields";
import {
  BuildStatusHero,
  describeTestsPill
} from "../src/panels/buildDetails/webview/components/buildDetails/hero/BuildStatusHero";
import { CoverageGlanceCard } from "../src/panels/buildDetails/webview/components/buildDetails/overview/CoverageGlanceCard";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

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
    createElement(
      TooltipProvider,
      null,
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
        onCopyLink: () => undefined,
        keptForever: false,
        canManage: true,
        canDelete: true,
        managementBusy: false,
        onBuildManagement: () => undefined,
        ...overrides
      })
    )
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

function findButton(html: string, label: string): string {
  const match = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`));
  assert.ok(match, `missing button ${label}`);
  return match[0];
}

describe("BuildStatusHero build management", () => {
  it("renders keep, edit, and delete before Open in Jenkins", () => {
    const html = renderHero({ isRunning: false, resultClass: "success" });

    const keep = findButton(html, "Keep this build forever");
    assert.match(keep, /aria-pressed="false"/);
    assert.doesNotMatch(keep, / disabled=""/);
    assert.doesNotMatch(findButton(html, "Edit display name or description"), / disabled=""/);
    assert.doesNotMatch(findButton(html, "Delete build"), / disabled=""/);
    const order = [
      "Keep this build forever",
      "Edit display name or description",
      "Delete build",
      "Open in Jenkins"
    ].map((label) => html.indexOf(`aria-label="${label}"`));
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order
    );
    assert.doesNotMatch(html, /Kept forever/);
  });

  it("places Copy link just before Open in Jenkins and disables it without a build URL", () => {
    const html = renderHero({ buildUrl: "https://jenkins.example/job/app/1/" });
    const copy = findButton(html, "Copy link");
    assert.doesNotMatch(copy, / disabled=""/);
    const copyIndex = html.indexOf('aria-label="Copy link"');
    assert.ok(html.indexOf('aria-label="Delete build"') < copyIndex);
    assert.ok(copyIndex < html.indexOf('aria-label="Open in Jenkins"'));

    assert.match(findButton(renderHero(), "Copy link"), / disabled=""/);
  });

  it("marks a kept build with a pressed toggle and a badge", () => {
    const html = renderHero({ keptForever: true });

    assert.match(findButton(html, "Stop keeping this build forever"), /aria-pressed="true"/);
    assert.match(html, /id="detail-kept-forever"[^>]*>.*Kept forever/);
  });

  it("disables delete for running builds but keeps the other actions", () => {
    const html = renderHero({ canDelete: false });

    assert.match(findButton(html, "Delete build"), / disabled=""/);
    assert.doesNotMatch(findButton(html, "Keep this build forever"), / disabled=""/);
    assert.doesNotMatch(findButton(html, "Edit display name or description"), / disabled=""/);
    // The wrapper keeps a tab stop so the tooltip can explain the disabled button.
    assert.match(html, /<span[^>]*tabindex="0"[^>]*><button[^>]*aria-label="Delete build"/);
  });

  it.each([
    ["details are not loaded", { canManage: false, canDelete: false }],
    ["a request is in progress", { managementBusy: true }]
  ])("disables every management action while %s", (_label, overrides) => {
    const html = renderHero(overrides);

    for (const label of [
      "Keep this build forever",
      "Edit display name or description",
      "Delete build"
    ]) {
      assert.match(findButton(html, label), / disabled=""/);
    }
  });

  it("renders the description as plain text with preserved line breaks", () => {
    const html = renderHero({ description: 'Line one <img src=x onerror="alert(1)">\nLine two' });

    assert.match(html, /class="[^"]*whitespace-pre-line[^"]*"/);
    assert.match(html, /Line one &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;\nLine two/);
    assert.doesNotMatch(html, /<img/);
  });

  it("omits the description block when there is none", () => {
    assert.doesNotMatch(renderHero(), /whitespace-pre-line/);
  });
});

describe("BuildStatusHero accessibility and meta", () => {
  it("names the progress bar while the build runs", () => {
    assert.match(
      renderHero(),
      /role="progressbar"[^>]*aria-label="Build in progress"|aria-label="Build in progress"[^>]*role="progressbar"/
    );
  });

  it("omits empty culprits along with their separator", () => {
    for (const culpritsLabel of ["", "None", "—"]) {
      const html = renderToStaticMarkup(
        createElement(BuildDetailsMetaFields, {
          durationLabel: "1m",
          timestampLabel: "today",
          culpritsLabel
        })
      );
      assert.doesNotMatch(html, /detail-culprits/);
      assert.equal(html.match(/>·</g)?.length, 1);
    }

    const withCulprits = renderToStaticMarkup(
      createElement(BuildDetailsMetaFields, {
        durationLabel: "1m",
        timestampLabel: "today",
        culpritsLabel: "Jane Doe"
      })
    );
    assert.match(withCulprits, /id="detail-culprits"[^>]*>.*Jane Doe/);
    assert.equal(withCulprits.match(/>·</g)?.length, 2);
  });

  it("reports skipped tests without implying failures in the tests pill", () => {
    const pill = describeTestsPill({
      ...EMPTY_TESTS,
      totalCount: 926,
      skippedCount: 6,
      passedCount: 920,
      hasAnyResults: true
    });
    assert.equal(pill?.label, "920 passed · 6 skipped");
    assert.match(pill?.className ?? "", /text-success/);
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

  it("labels the overall gate result as a quality gate, not a build status", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageGlanceCard, {
        coverageState: {
          ...idle,
          status: "available",
          overallQualityGateStatusLabel: "Unstable",
          overallQualityGateStatusClass: "warning"
        }
      })
    );
    assert.match(html, />Quality gate: Unstable</);
  });

  it("links to coverage details with a matching accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageGlanceCard, { coverageState: idle, onShowTests: () => undefined })
    );
    assert.match(html, /Loading coverage results/);
    assert.match(html, />View coverage details</);
    assert.doesNotMatch(html, /aria-label="Open the Tests tab/);
  });

  it("shows the error message with a failure border", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageGlanceCard, {
        coverageState: { ...idle, status: "error", errorMessage: "HTTP 500" }
      })
    );
    assert.match(html, /Coverage data could not be loaded for this build\. HTTP 500/);
    assert.match(html, /border-failure-border-subtle/);
  });

  it("explains when coverage is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(CoverageGlanceCard, { coverageState: { ...idle, status: "unavailable" } })
    );
    assert.match(html, /Coverage data is unavailable for this build\./);
    assert.doesNotMatch(html, /border-failure-border-subtle/);
  });
});
