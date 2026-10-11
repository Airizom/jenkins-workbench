import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

const buildConsoleSegmentsMock = vi.fn(() => []);
const scrollConsoleToBottomMock = vi.fn();
const matches: never[] = [];
const memoizedValues: Array<{ dependencies: readonly unknown[]; value: unknown }> = [];
let memoIndex = 0;

function beginRender(): void {
  memoIndex = 0;
}

function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T {
  const index = memoIndex;
  memoIndex += 1;
  const previous = memoizedValues[index];
  if (
    previous &&
    previous.dependencies.length === dependencies.length &&
    previous.dependencies.every((dependency, dependencyIndex) =>
      Object.is(dependency, dependencies[dependencyIndex])
    )
  ) {
    return previous.value as T;
  }

  const value = factory();
  memoizedValues[index] = { dependencies, value };
  return value;
}

vi.doMock("react", () => ({
  useCallback: <T>(callback: T): T => callback,
  useEffect: (effect: () => void, dependencies: readonly unknown[]) =>
    useMemo(effect, dependencies),
  useMemo,
  useRef: <T>(current: T) => ({ current }),
  useState: <T>(initial: T) => [initial, () => undefined]
}));
vi.doMock("../src/panels/buildDetails/webview/hooks/consoleSearch/buildConsoleSegments", () => ({
  buildConsoleSegments: buildConsoleSegmentsMock,
  normalizeConsoleSourceReferences: () => []
}));
vi.doMock("../src/panels/buildDetails/webview/hooks/useConsoleOutputScroll", () => ({
  prefersReducedMotion: () => false,
  useConsoleOutputScroll: () => ({
    showScrollToTop: false,
    isAtBottom: true,
    scrollConsoleToBottom: scrollConsoleToBottomMock,
    scrollConsoleToTop: () => undefined
  })
}));
vi.doMock("../src/panels/buildDetails/webview/hooks/useConsoleSearch", () => ({
  useConsoleSearch: () => ({
    matches,
    activeMatchIndex: -1,
    isSearchActive: false,
    consoleOutputRef: { current: null },
    openSearchToolbar: () => undefined
  })
}));
vi.doMock("../src/panels/buildDetails/webview/components/ConsoleLogSearchBody", () => ({
  ConsoleLogSearchBody: () => null
}));

const { ConsoleLogViewer } = await import(
  "../src/panels/buildDetails/webview/components/buildDetails/ConsoleLogViewer"
);

beforeEach(() => {
  memoizedValues.length = 0;
  buildConsoleSegmentsMock.mockClear();
  scrollConsoleToBottomMock.mockClear();
});

describe("ConsoleLogViewer", () => {
  it.each([false, true])("follows equal-length output changes (HTML: %s)", (useHtmlModel) => {
    const initialText = "long line\n".repeat(100);
    const replacementText = "a\n".repeat(500);
    assert.equal(initialText.length, replacementText.length);
    const props = {
      text: initialText,
      truncated: true,
      followLog: true,
      canFollow: true,
      isActive: true,
      onOpenExternal: () => undefined
    };
    const render = (text: string) => {
      beginRender();
      ConsoleLogViewer({
        ...props,
        text: useHtmlModel ? "fallback" : text,
        htmlModel: useHtmlModel ? { nodes: [], text } : undefined
      });
    };

    render(initialText);
    assert.equal(scrollConsoleToBottomMock.mock.calls.length, 1);
    render(initialText);
    assert.equal(scrollConsoleToBottomMock.mock.calls.length, 1);
    render(replacementText);
    assert.equal(scrollConsoleToBottomMock.mock.calls.length, 2);
  });

  it("reuses rendered segments when source references are omitted", () => {
    const props = {
      text: "console output",
      truncated: false,
      maxChars: 100,
      followLog: false,
      canFollow: false,
      isActive: true,
      onOpenExternal: () => undefined
    };

    beginRender();
    ConsoleLogViewer(props);
    beginRender();
    ConsoleLogViewer(props);

    assert.equal(buildConsoleSegmentsMock.mock.calls.length, 1);
  });
});
