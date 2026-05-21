import * as React from "react";
import type { ConsoleSearchState } from "../hooks/useConsoleSearch";
import { ConsoleSearchToolbar } from "./ConsoleSearchToolbar";
import {
  ConsoleOutputEmptyState,
  ConsoleOutputErrorNotice,
  ConsoleOutputNotice,
  ConsoleOutputViewport
} from "./buildDetails/consoleOutput";

export function ConsoleLogSearchBody({
  consoleSearch,
  note,
  error,
  hasOutput,
  followLog,
  showScrollToTop,
  onScrollToTop,
  segments,
  className
}: {
  consoleSearch: ConsoleSearchState;
  note?: string;
  error?: string;
  hasOutput: boolean;
  followLog: boolean;
  showScrollToTop: boolean;
  onScrollToTop: () => void;
  segments: React.ReactNode[];
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
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
      <ConsoleOutputNotice note={note ?? ""} />
      <ConsoleOutputErrorNotice error={error} />
      {!error && hasOutput ? (
        <ConsoleOutputViewport
          consoleOutputRef={consoleSearch.consoleOutputRef}
          showScrollToTop={showScrollToTop}
          followLog={followLog}
          onScrollToTop={onScrollToTop}
          segments={segments}
        />
      ) : null}
      {!error && !hasOutput ? <ConsoleOutputEmptyState /> : null}
    </div>
  );
}
