import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel,
  PipelineNodeLogViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { ConsoleSearchToolbar } from "../src/panels/buildDetails/webview/components/ConsoleSearchToolbar";
import { PipelineNodeLogPane } from "../src/panels/buildDetails/webview/components/buildDetails/PipelineNodeLogPane";
import { ConsoleOutputHeader } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/ConsoleOutputHeader";
import { ConsoleOutputErrorNotice } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/ConsoleOutputNotice";
import { ConsoleOutputViewport } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/ConsoleOutputViewport";
import { buildConsoleTruncationNote } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/consoleOutputUtils";
import { TestResultsToolbar } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/TestResultsToolbar";
import { resolveFailureBlocks } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/testResultsUtils";
import { readConsoleScrollPosition } from "../src/panels/buildDetails/webview/hooks/useConsoleOutputScroll";
import { TooltipProvider } from "../src/panels/shared/webview/components/ui/tooltip";

function withTooltips(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

describe("console truncation note", () => {
  it("omits the character count when the limit is unknown", () => {
    assert.equal(buildConsoleTruncationNote(true, 0), "Earlier output omitted.");
    assert.equal(buildConsoleTruncationNote(true, undefined), "Earlier output omitted.");
    assert.equal(buildConsoleTruncationNote(false, 0), "");
  });

  it("states the window when the limit is known", () => {
    assert.equal(
      buildConsoleTruncationNote(true, 1000),
      "Earlier output omitted. Showing the last 1,000 characters."
    );
  });
});

describe("readConsoleScrollPosition", () => {
  it("treats positions within the threshold of the end as the bottom", () => {
    assert.equal(
      readConsoleScrollPosition({ scrollTop: 780, clientHeight: 200, scrollHeight: 1000 })
        .isAtBottom,
      true
    );
    assert.equal(
      readConsoleScrollPosition({ scrollTop: 700, clientHeight: 200, scrollHeight: 1000 })
        .isAtBottom,
      false
    );
    assert.equal(
      readConsoleScrollPosition({ scrollTop: 0, clientHeight: 200, scrollHeight: 200 }).isAtBottom,
      true
    );
  });
});

describe("console viewport", () => {
  const baseProps = {
    consoleOutputRef: { current: null },
    showScrollToTop: false,
    showJumpToLatest: false,
    onScrollToTop: () => undefined,
    onJumpToLatest: () => undefined,
    segments: ["line"]
  };

  it("keeps streamed output out of the live region and stays keyboard scrollable", () => {
    const html = withTooltips(createElement(ConsoleOutputViewport, baseProps));

    assert.match(html, /role="log"/);
    assert.match(html, /aria-live="off"/);
    assert.match(html, /tabindex="0"/);
    assert.doesNotMatch(html, /Jump to latest/);
  });

  it("offers Jump to latest when requested", () => {
    const html = withTooltips(
      createElement(ConsoleOutputViewport, { ...baseProps, showJumpToLatest: true })
    );

    assert.match(html, />Jump to latest</);
  });
});

describe("console notices and header", () => {
  it("renders Retry on console errors when a retry handler exists", () => {
    const withRetry = renderToStaticMarkup(
      createElement(ConsoleOutputErrorNotice, { error: "Timed out", onRetry: () => undefined })
    );
    const withoutRetry = renderToStaticMarkup(
      createElement(ConsoleOutputErrorNotice, { error: "Timed out" })
    );

    assert.match(withRetry, />Retry</);
    assert.doesNotMatch(withoutRetry, />Retry</);
  });

  it("hides Follow for completed builds and shows the diagnostic jump when offered", () => {
    const props = {
      hasConsoleOutput: true,
      lineCount: 10,
      followLog: true,
      onSearch: () => undefined,
      onExport: () => undefined,
      onFollowLogChange: () => undefined
    };
    const running = renderToStaticMarkup(
      createElement(ConsoleOutputHeader, { ...props, canFollow: true })
    );
    const completed = renderToStaticMarkup(
      createElement(ConsoleOutputHeader, {
        ...props,
        canFollow: false,
        onJumpToFirstDiagnostic: () => undefined
      })
    );

    assert.match(running, />Follow</);
    assert.doesNotMatch(running, /First diagnostic/);
    assert.doesNotMatch(completed, />Follow</);
    assert.match(completed, /First diagnostic/);
  });

  it("announces the search match count through a polite status", () => {
    const html = renderToStaticMarkup(
      createElement(ConsoleSearchToolbar, {
        visible: true,
        query: "error",
        useRegex: false,
        matchCountLabel: "2 / 5",
        matchCount: 5,
        isSearchActive: true,
        inputRef: { current: null },
        onChange: () => undefined,
        onKeyDown: () => undefined,
        onToggleRegex: () => undefined,
        onPrev: () => undefined,
        onNext: () => undefined,
        onClear: () => undefined
      })
    );

    assert.match(html, /role="status" aria-live="polite"[^>]*>Match 2 of 5</);
  });
});

describe("PipelineNodeLogPane", () => {
  const log: PipelineNodeLogViewModel = {
    target: { key: "stage:tests", kind: "stage", name: "Integration tests", nodeId: "12" },
    text: "line one\nline two",
    truncated: true,
    loading: false,
    consoleUrl: "https://jenkins.example/job/a/1/execution/node/12/log"
  };
  const render = (canFollow: boolean) =>
    withTooltips(
      createElement(PipelineNodeLogPane, {
        log,
        canFollow,
        onClear: () => undefined,
        onExport: () => undefined,
        onOpenExternal: () => undefined,
        isActive: true
      })
    );

  it("names every icon-only action and titles the log target", () => {
    const html = render(true);

    for (const label of ["Search stage log", "Open in Jenkins", "Export stage log", "Close log"]) {
      assert.match(html, new RegExp(`aria-label="${label}"`));
    }
    assert.match(html, /<h3[^>]*tabindex="-1"[^>]*title="Integration tests"/);
  });

  it("describes truncation without a zero character count", () => {
    const html = render(true);

    assert.match(html, /Earlier output omitted\./);
    assert.doesNotMatch(html, /last 0 characters/);
  });

  it("offers Follow only while the node can still produce output", () => {
    assert.match(render(true), />Follow</);
    assert.doesNotMatch(render(false), />Follow</);
  });
});

describe("TestResultsToolbar", () => {
  const summary: BuildTestsSummaryViewModel = {
    totalCount: 10,
    failedCount: 2,
    skippedCount: 1,
    passedCount: 7,
    summaryLabel: "10 tests",
    hasAnyResults: true,
    hasDetailedResults: true,
    detailsUnavailable: false,
    logsIncluded: false,
    canLoadLogs: true
  };
  const render = (results: BuildTestResultsViewModel) =>
    renderToStaticMarkup(
      createElement(TestResultsToolbar, {
        summary,
        results,
        statusFilter: "failed",
        query: "",
        onStatusFilterChange: () => undefined,
        onQueryChange: () => undefined,
        onReloadWithLogs: () => undefined
      })
    );

  it("labels the filter group, wraps on narrow widths, and names the output action", () => {
    const html = render({ items: [], loading: false });

    assert.match(html, /aria-label="Filter tests by status"/);
    assert.match(html, /flex-wrap/);
    assert.match(html, /w-full flex-1 sm:w-auto sm:min-w-\[260px\]/);
    assert.match(html, />Load test output</);
    assert.match(html, /title="Fetch each test&#x27;s stdout and stderr from Jenkins"/);
  });

  it("shows progress on the output action while loading", () => {
    assert.match(render({ items: [], loading: true }), />Loading test output…</);
  });
});

describe("resolveFailureBlocks", () => {
  it("shows a stack trace that repeats the failure message once, labelled Failure", () => {
    assert.deepEqual(
      resolveFailureBlocks("expected 1 but was 2", "expected 1 but was 2\n\tat Foo.test"),
      [{ label: "Failure", value: "expected 1 but was 2\n\tat Foo.test" }]
    );
  });

  it("keeps both blocks when the stack trace adds a different message", () => {
    assert.deepEqual(resolveFailureBlocks("Timeout", "java.lang.AssertionError\n\tat Foo"), [
      { label: "Failure", value: "Timeout" },
      { label: "Stack Trace", value: "java.lang.AssertionError\n\tat Foo" }
    ]);
  });

  it("returns only the parts that exist", () => {
    assert.deepEqual(resolveFailureBlocks(undefined, "trace"), [
      { label: "Stack Trace", value: "trace" }
    ]);
    assert.deepEqual(resolveFailureBlocks("  ", undefined), []);
  });
});
