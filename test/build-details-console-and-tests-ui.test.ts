import assert from "node:assert/strict";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import type {
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel,
  PipelineNodeLogViewModel
} from "../src/panels/buildDetails/shared/BuildDetailsContracts";
import { ConsoleLogSearchBody } from "../src/panels/buildDetails/webview/components/ConsoleLogSearchBody";
import { ConsoleSearchToolbar } from "../src/panels/buildDetails/webview/components/ConsoleSearchToolbar";
import { PipelineNodeLogPane } from "../src/panels/buildDetails/webview/components/buildDetails/PipelineNodeLogPane";
import { ConsoleOutputHeader } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/ConsoleOutputHeader";
import { ConsoleOutputErrorNotice } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/ConsoleOutputNotice";
import { ConsoleOutputViewport } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/ConsoleOutputViewport";
import { buildConsoleTruncationNote } from "../src/panels/buildDetails/webview/components/buildDetails/consoleOutput/consoleOutputUtils";
import { TestResultsToolbar } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/TestResultsToolbar";
import { resolveFailureBlocks } from "../src/panels/buildDetails/webview/components/buildDetails/testResults/testResultsUtils";
import { readConsoleScrollPosition } from "../src/panels/buildDetails/webview/hooks/useConsoleOutputScroll";
import type { ConsoleSearchState } from "../src/panels/buildDetails/webview/hooks/useConsoleSearch";
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

describe("ConsoleLogSearchBody", () => {
  const consoleSearch = {
    showSearchToolbar: true,
    searchQuery: "",
    useRegex: false,
    matchCountLabel: "0 / 0",
    matchCount: 0,
    isSearchActive: false,
    searchInputRef: { current: null },
    searchToolbarRef: { current: null },
    consoleOutputRef: { current: null },
    handleSearchChange: () => undefined,
    handleSearchKeyDown: () => undefined,
    handleSearchStep: () => undefined,
    handleClearSearch: () => undefined,
    setUseRegex: () => undefined
  } as unknown as ConsoleSearchState;
  const baseProps = {
    consoleSearch,
    hasOutput: true,
    showScrollToTop: false,
    showJumpToLatest: false,
    onScrollToTop: () => undefined,
    onJumpToLatest: () => undefined,
    onRetry: () => undefined,
    segments: ["line one"]
  };
  const render = (props: Partial<Parameters<typeof ConsoleLogSearchBody>[0]>) =>
    withTooltips(createElement(ConsoleLogSearchBody, { ...baseProps, ...props }));

  it("keeps loaded output below a load error with Retry", () => {
    const html = render({ error: "Timed out" });

    assert.match(html, /Timed out[\s\S]*>Retry<[\s\S]*role="log"[^>]*>line one</);
    assert.doesNotMatch(html, /No console output/);
    const describedBy = /role="log"[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.match(html, new RegExp(`id="${describedBy}"[^>]*>[\\s\\S]*Timed out`));
  });

  it("shows a loading state instead of the empty state while loading", () => {
    const loading = render({ hasOutput: false, loading: true, segments: [] });
    const empty = render({
      hasOutput: false,
      segments: [],
      emptyTitle: "No log output",
      emptyDescription: "This step produced no log output."
    });

    assert.match(loading, /role="status"[^>]*>[\s\S]*Loading log…/);
    assert.doesNotMatch(loading, /No console output/);
    assert.match(empty, /No log output/);
    assert.match(empty, /This step produced no log output\./);
    assert.doesNotMatch(
      render({ hasOutput: false, segments: [], error: "x" }),
      /No console output/
    );
  });

  it("gives each mounted console viewer unique ids", () => {
    const html = withTooltips(
      createElement(
        Fragment,
        null,
        createElement(ConsoleLogSearchBody, { ...baseProps, note: "Earlier output omitted." }),
        createElement(ConsoleLogSearchBody, { ...baseProps, note: "Earlier output omitted." })
      )
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

    assert.ok(ids.length >= 6);
    assert.equal(new Set(ids).size, ids.length);
    assert.doesNotMatch(html, /id="console-/);
    for (const [, target] of html.matchAll(/(?:for|aria-controls|aria-describedby)="([^"]+)"/g)) {
      assert.ok(ids.includes(target), `missing id ${target}`);
    }
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

  it("shows loading, then step-specific empty text, instead of the build empty state", () => {
    const renderLog = (overrides: Partial<PipelineNodeLogViewModel>, canFollow = false) =>
      withTooltips(
        createElement(PipelineNodeLogPane, {
          log: {
            ...log,
            target: { key: "step:1", kind: "step", name: "sh", nodeId: "13" },
            text: "",
            truncated: false,
            ...overrides
          },
          canFollow,
          onClear: () => undefined,
          onExport: () => undefined,
          onOpenExternal: () => undefined,
          isActive: true
        })
      );

    const loading = renderLog({ loading: true });
    assert.match(loading, /Loading log…/);
    assert.doesNotMatch(loading, /No log output|No console output/);
    assert.match(renderLog({ loading: false }), /This step produced no log output\./);
    assert.match(
      renderLog({ loading: false }, true),
      /This step has not produced any log output yet\./
    );
  });

  it("keeps the step log visible when a refresh fails", () => {
    const failed = withTooltips(
      createElement(PipelineNodeLogPane, {
        log: { ...log, error: "Connection reset" },
        canFollow: false,
        onClear: () => undefined,
        onExport: () => undefined,
        onRetry: () => undefined,
        onOpenExternal: () => undefined,
        isActive: true
      })
    );

    assert.match(failed, /Connection reset[\s\S]*>Retry<[\s\S]*line one\nline two/);
  });

  it("renders a focusable empty state for returning focus after Close log", () => {
    const html = withTooltips(
      createElement(PipelineNodeLogPane, {
        log: { text: "", truncated: false, loading: false },
        canFollow: false,
        onClear: () => undefined,
        onExport: () => undefined,
        onOpenExternal: () => undefined,
        isActive: true
      })
    );

    assert.match(html, /<div tabindex="-1"[^>]*>[\s\S]*No log selected/);
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
      { label: "Stack trace", value: "java.lang.AssertionError\n\tat Foo" }
    ]);
  });

  it("returns only the parts that exist", () => {
    assert.deepEqual(resolveFailureBlocks(undefined, "trace"), [
      { label: "Stack trace", value: "trace" }
    ]);
    assert.deepEqual(resolveFailureBlocks("  ", undefined), []);
  });
});
