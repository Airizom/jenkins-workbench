import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

const stripAnsiMock = vi.fn((value: string): string => `stripped:${value}`);
const postVsCodeMessageMock = vi.fn();

vi.doMock("react", () => ({
  useMemo: <T>(factory: () => T): T => factory()
}));
vi.doMock("../src/buildDiagnostics/BuildDiagnosticConsoleText", () => ({
  stripConsoleControlSequences: stripAnsiMock
}));
vi.doMock("../src/panels/shared/webview/lib/vscodeApi", () => ({
  postVsCodeMessage: postVsCodeMessageMock
}));
vi.doMock("../src/panels/buildDetails/webview/components/buildDetails/ConsoleLogViewer", () => ({
  ConsoleLogViewer: () => null
}));
vi.doMock("../src/panels/buildDetails/webview/components/buildDetails/consoleOutput", () => ({
  ConsoleOutputHeader: () => null
}));

const { ConsoleOutputSection } = await import(
  "../src/panels/buildDetails/webview/components/buildDetails/ConsoleOutputSection"
);

const baseProps = {
  consoleText: "",
  consoleTruncated: false,
  consoleMaxChars: 100,
  followLog: true,
  isRunning: true,
  isActive: true,
  onToggleFollowLog: () => undefined,
  onExportLogs: () => undefined,
  onOpenExternal: () => undefined
};

beforeEach(() => {
  stripAnsiMock.mockClear();
  postVsCodeMessageMock.mockClear();
});

describe("ConsoleOutputSection", () => {
  it("skips ANSI stripping when an HTML console model is available", () => {
    ConsoleOutputSection({
      ...baseProps,
      consoleText: "\u001b[31mplain fallback\u001b[0m",
      consoleHtmlModel: { nodes: [], text: "HTML console text" }
    });

    assert.equal(stripAnsiMock.mock.calls.length, 0);
  });

  it("strips ANSI sequences for plain-text console output", () => {
    const consoleText = "\u001b[31mplain console text\u001b[0m";

    ConsoleOutputSection({ ...baseProps, consoleText });

    assert.deepEqual(stripAnsiMock.mock.calls, [[consoleText]]);
  });

  it("delegates enabling follow mode without scrolling from the header", () => {
    const onToggleFollowLog = vi.fn();
    const scrollToBottom = vi.fn();
    const viewer = ConsoleOutputSection({
      ...baseProps,
      followLog: false,
      onToggleFollowLog
    });
    const header = viewer.props.renderHeader({
      hasOutput: true,
      lineCount: 1,
      openSearchToolbar: () => undefined,
      scrollToBottom,
      isSearchActive: false
    });

    header.props.onFollowLogChange(true);

    assert.deepEqual(onToggleFollowLog.mock.calls, [[true]]);
    assert.equal(scrollToBottom.mock.calls.length, 0);
  });

  it("only offers Follow while the build is running", () => {
    const renderHeader = (isRunning: boolean) =>
      ConsoleOutputSection({ ...baseProps, isRunning }).props.renderHeader({
        hasOutput: true,
        lineCount: 1,
        openSearchToolbar: () => undefined
      });

    const running = ConsoleOutputSection({ ...baseProps, isRunning: true });
    const completed = ConsoleOutputSection({ ...baseProps, isRunning: false });

    assert.equal(running.props.canFollow, true);
    assert.equal(completed.props.canFollow, false);
    assert.equal(renderHeader(true).props.canFollow, true);
    assert.equal(renderHeader(false).props.canFollow, false);
  });

  it("passes the diagnostic jump action to the header", () => {
    const jumpToFirstDiagnostic = vi.fn();
    const header = ConsoleOutputSection(baseProps).props.renderHeader({
      hasOutput: true,
      lineCount: 1,
      openSearchToolbar: () => undefined,
      jumpToFirstDiagnostic
    });

    assert.equal(header.props.onJumpToFirstDiagnostic, jumpToFirstDiagnostic);
  });

  it("retries a failed console load by refreshing build details", () => {
    const viewer = ConsoleOutputSection({ ...baseProps, consoleError: "Timed out" });

    viewer.props.onRetry();

    assert.deepEqual(postVsCodeMessageMock.mock.calls, [[{ type: "refreshBuildDetails" }]]);
  });
});
