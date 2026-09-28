import * as React from "react";
import type { ConsoleSearchState } from "../hooks/useConsoleSearch";
import {
  ConsoleOutputEmptyState,
  ConsoleOutputErrorNotice,
  ConsoleOutputNotice,
  ConsoleOutputViewport
} from "./buildDetails/consoleOutput";
import { ConsoleSearchToolbar } from "./ConsoleSearchToolbar";
export function ConsoleLogSearchBody({
  consoleSearch,
  note,
  error,
  hasOutput,
  outputLabel,
  showScrollToTop,
  showJumpToLatest,
  onScrollToTop,
  onJumpToLatest,
  onRetry,
  segments,
  className
}: {
  consoleSearch: ConsoleSearchState;
  note?: string;
  error?: string;
  hasOutput: boolean;
  outputLabel?: string;
  showScrollToTop: boolean;
  showJumpToLatest: boolean;
  onScrollToTop: () => void;
  onJumpToLatest: () => void;
  onRetry?: () => void;
  segments: React.ReactNode[];
  className?: string;
}): React.JSX.Element {
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
      <ConsoleOutputErrorNotice error={error} onRetry={onRetry} />
      {!error && hasOutput ? (
        <ConsoleOutputViewport
          consoleOutputRef={consoleSearch.consoleOutputRef}
          showScrollToTop={showScrollToTop}
          showJumpToLatest={showJumpToLatest}
          label={outputLabel}
          onScrollToTop={onScrollToTop}
          onJumpToLatest={onJumpToLatest}
          segments={segments}
        />
      ) : null}
      {!error && !hasOutput ? <ConsoleOutputEmptyState /> : null}
    </div>
  );
}
