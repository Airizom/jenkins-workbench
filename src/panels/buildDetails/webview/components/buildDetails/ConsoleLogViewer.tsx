import * as React from "react";
import { useConsoleOutputScroll } from "../../hooks/useConsoleOutputScroll";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { ConsoleLogSearchBody } from "../ConsoleLogSearchBody";
import { buildConsoleTruncationNote, countConsoleLines } from "./consoleOutput/consoleOutputUtils";

const { useEffect, useMemo } = React;

export type ConsoleLogViewerHeaderState = {
  hasOutput: boolean;
  lineCount: number;
  openSearchToolbar: () => void;
  scrollToBottom: () => void;
  isSearchActive: boolean;
};

export function ConsoleLogViewer({
  text,
  htmlModel,
  truncated,
  maxChars,
  error,
  followLog,
  isActive,
  scrollKeyPrefix,
  className,
  bodyClassName,
  onOpenExternal,
  renderHeader
}: {
  text: string;
  htmlModel?: ConsoleHtmlModel;
  truncated: boolean;
  maxChars: number;
  error?: string;
  followLog: boolean;
  isActive: boolean;
  scrollKeyPrefix?: string;
  className?: string;
  bodyClassName?: string;
  onOpenExternal: (url: string) => void;
  renderHeader?: (state: ConsoleLogViewerHeaderState) => React.ReactNode;
}): JSX.Element {
  const sourceText = htmlModel?.text ?? text;
  const consoleSearch = useConsoleSearch(sourceText, isActive);

  const segments = useMemo(() => {
    if (htmlModel) {
      return renderConsoleHtmlWithHighlights(
        htmlModel,
        consoleSearch.matches,
        consoleSearch.activeMatchIndex,
        onOpenExternal
      );
    }
    return consoleSearch.consoleSegments;
  }, [
    htmlModel,
    consoleSearch.matches,
    consoleSearch.activeMatchIndex,
    consoleSearch.consoleSegments,
    onOpenExternal
  ]);

  const scrollKey = useMemo(() => {
    const sourceKey = `${sourceText.length}-${error ?? ""}`;
    return scrollKeyPrefix ? `${scrollKeyPrefix}-${sourceKey}` : sourceKey;
  }, [scrollKeyPrefix, sourceText, error]);

  const { showScrollToTop, scrollConsoleToBottom, scrollConsoleToTop } = useConsoleOutputScroll(
    consoleSearch.consoleOutputRef,
    scrollKey
  );

  useEffect(() => {
    if (!isActive || !followLog || consoleSearch.isSearchActive) {
      return;
    }
    scrollConsoleToBottom();
  }, [isActive, followLog, scrollKey, consoleSearch.isSearchActive, scrollConsoleToBottom]);

  const note = useMemo(
    () => buildConsoleTruncationNote(truncated, maxChars),
    [truncated, maxChars]
  );
  const hasOutput = sourceText.length > 0;
  const lineCount = useMemo(() => countConsoleLines(sourceText), [sourceText]);

  return (
    <div className={className}>
      {renderHeader?.({
        hasOutput,
        lineCount,
        openSearchToolbar: consoleSearch.openSearchToolbar,
        scrollToBottom: scrollConsoleToBottom,
        isSearchActive: consoleSearch.isSearchActive
      })}
      <ConsoleLogSearchBody
        className={bodyClassName}
        consoleSearch={consoleSearch}
        note={note}
        error={error}
        hasOutput={hasOutput}
        followLog={followLog}
        showScrollToTop={showScrollToTop}
        onScrollToTop={scrollConsoleToTop}
        segments={segments}
      />
    </div>
  );
}
