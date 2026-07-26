import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

const stripAnsiMock = vi.fn((value: string): string => `stripped:${value}`);

vi.doMock("react", () => ({
  useMemo: <T>(factory: () => T): T => factory()
}));
vi.doMock("../src/panels/buildDetails/webview/lib/ansi", () => ({
  stripAnsi: stripAnsiMock
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
  isActive: true,
  onToggleFollowLog: () => undefined,
  onExportLogs: () => undefined,
  onOpenExternal: () => undefined
};

beforeEach(() => {
  stripAnsiMock.mockClear();
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
});
