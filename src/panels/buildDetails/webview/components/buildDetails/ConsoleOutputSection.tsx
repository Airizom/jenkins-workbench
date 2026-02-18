import * as React from "react";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";
import { stripAnsi } from "../../lib/ansi";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { ConsoleSearchToolbar } from "../ConsoleSearchToolbar";
import { useConsoleOutputScroll } from "../../hooks/useConsoleOutputScroll";
import {
  buildConsoleTruncationNote,
  countConsoleLines
} from "./consoleOutput/consoleOutputUtils";
import {
  ConsoleOutputEmptyState,
  ConsoleOutputErrorNotice,
  ConsoleOutputHeader,
  ConsoleOutputNotice,
  ConsoleOutputViewport
} from "./consoleOutput";

const { useEffect, useMemo } = React;

export function ConsoleOutputSection({
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
  isActive,
  onToggleFollowLog,
  onExportLogs,
  onOpenExternal
}: {
  consoleText: string;
  consoleHtmlModel?: ConsoleHtmlModel;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  followLog: boolean;
  isActive: boolean;
  onToggleFollowLog: (value: boolean) => void;
  onExportLogs: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const displayConsoleText = useMemo(() => stripAnsi(consoleText), [consoleText]);
  const consoleSourceText = consoleHtmlModel?.text ?? displayConsoleText;
  const consoleSearch = useConsoleSearch(consoleSourceText);

  const consoleSegments = useMemo(() => {
    if (consoleHtmlModel) {
      return renderConsoleHtmlWithHighlights(
        consoleHtmlModel,
        consoleSearch.matches,
        consoleSearch.activeMatchIndex,
        onOpenExternal
      );
    }
    return consoleSearch.consoleSegments;
  }, [
    consoleHtmlModel,
    consoleSearch.matches,
    consoleSearch.activeMatchIndex,
    consoleSearch.consoleSegments,
    onOpenExternal
  ]);

  const consoleScrollKey = useMemo(
    () => `${consoleSourceText.length}-${consoleError ?? ""}`,
    [consoleSourceText, consoleError]
  );

  const { showScrollToTop, scrollConsoleToBottom, scrollConsoleToTop } = useConsoleOutputScroll(
    consoleSearch.consoleOutputRef,
    consoleScrollKey
  );

  useEffect(() => {
    if (!isActive || !followLog || consoleSearch.isSearchActive) {
      return;
    }
    if (consoleScrollKey || consoleScrollKey === "") {
      scrollConsoleToBottom();
    }
  }, [
    isActive,
    followLog,
    consoleScrollKey,
    consoleSearch.isSearchActive,
    scrollConsoleToBottom
  ]);

  const consoleNote = useMemo(
    () => buildConsoleTruncationNote(consoleTruncated, consoleMaxChars),
    [consoleTruncated, consoleMaxChars]
  );

  const hasConsoleOutput = consoleSourceText.length > 0;
  const lineCount = useMemo(() => countConsoleLines(consoleSourceText), [consoleSourceText]);

  const handleFollowLogChange = (checked: boolean) => {
    onToggleFollowLog(checked);
    if (checked && isActive && !consoleSearch.isSearchActive) {
      scrollConsoleToBottom();
    }
  };

  const handleExportLogs = () => {
    onExportLogs();
  };

  return (
    <div className="flex flex-col gap-2">
      <ConsoleOutputHeader
        hasConsoleOutput={hasConsoleOutput}
        lineCount={lineCount}
        followLog={followLog}
        onSearch={consoleSearch.openSearchToolbar}
        onExport={handleExportLogs}
        onFollowLogChange={handleFollowLogChange}
      />

      <ConsoleSearchToolbar
        visible={consoleSearch.showSearchToolbar}
        query={consoleSearch.searchQuery}
        useRegex={consoleSearch.useRegex}
        matchCountLabel={consoleSearch.matchCountLabel}
        matchCount={consoleSearch.matchCount}
        isSearchActive={consoleSearch.isSearchActive}
        error={consoleSearch.searchError}
        tooManyMatchesLabel={consoleSearch.tooManyMatchesLabel}
        inputRef={consoleSearch.searchInputRef}
        onChange={consoleSearch.handleSearchChange}
        onKeyDown={consoleSearch.handleSearchKeyDown}
        onToggleRegex={() => consoleSearch.setUseRegex((prev) => !prev)}
        onPrev={() => consoleSearch.handleSearchStep("prev")}
        onNext={() => consoleSearch.handleSearchStep("next")}
        onClear={consoleSearch.handleClearSearch}
      />

      <ConsoleOutputNotice note={consoleNote} />
      <ConsoleOutputErrorNotice error={consoleError} />

      {!consoleError && hasConsoleOutput ? (
        <ConsoleOutputViewport
          consoleOutputRef={consoleSearch.consoleOutputRef}
          showScrollToTop={showScrollToTop}
          followLog={followLog}
          onScrollToTop={scrollConsoleToTop}
          segments={consoleSegments}
        />
      ) : null}

      {!consoleError && !hasConsoleOutput ? (
        <ConsoleOutputEmptyState />
      ) : null}
    </div>
  );
}
