import * as React from "react";
import type { ConsoleSearchState } from "../hooks/useConsoleSearch";
import {
  ConsoleOutputEmptyState,
  ConsoleOutputErrorNotice,
  ConsoleOutputLoadingState,
  ConsoleOutputNotice,
  ConsoleOutputViewport
} from "./buildDetails/consoleOutput";
import { ConsoleSearchToolbar } from "./ConsoleSearchToolbar";

// Console and Pipeline tabs both stay mounted, so every id here comes from useId.
export function ConsoleLogSearchBody({
  consoleSearch,
  note,
  error,
  hasOutput,
  loading = false,
  emptyTitle,
  emptyDescription,
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
  /** True while the first chunk of output is being fetched. */
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  outputLabel?: string;
  showScrollToTop: boolean;
  showJumpToLatest: boolean;
  onScrollToTop: () => void;
  onJumpToLatest: () => void;
  onRetry?: () => void;
  segments: React.ReactNode[];
  className?: string;
}): React.JSX.Element {
  const idPrefix = React.useId();
  const outputId = `${idPrefix}output`;
  const noteId = `${idPrefix}note`;
  const errorId = `${idPrefix}error`;
  const describedBy = [note ? noteId : undefined, error ? errorId : undefined]
    .filter(Boolean)
    .join(" ");

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
        containerRef={consoleSearch.searchToolbarRef}
        controlsId={hasOutput ? outputId : undefined}
        onChange={consoleSearch.handleSearchChange}
        onKeyDown={consoleSearch.handleSearchKeyDown}
        onToggleRegex={() => consoleSearch.setUseRegex((prev) => !prev)}
        onPrev={() => consoleSearch.handleSearchStep("prev")}
        onNext={() => consoleSearch.handleSearchStep("next")}
        onClear={consoleSearch.handleClearSearch}
      />
      <ConsoleOutputNotice id={noteId} note={note ?? ""} />
      {/* A failed refresh keeps the output already loaded, with its scroll and search state. */}
      <ConsoleOutputErrorNotice id={errorId} error={error} onRetry={onRetry} />
      {hasOutput ? (
        <ConsoleOutputViewport
          consoleOutputRef={consoleSearch.consoleOutputRef}
          id={outputId}
          describedBy={describedBy || undefined}
          showScrollToTop={showScrollToTop}
          showJumpToLatest={showJumpToLatest}
          label={outputLabel}
          onScrollToTop={onScrollToTop}
          onJumpToLatest={onJumpToLatest}
          segments={segments}
        />
      ) : null}
      {!hasOutput && loading ? <ConsoleOutputLoadingState /> : null}
      {!hasOutput && !loading && !error ? (
        <ConsoleOutputEmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}
    </div>
  );
}
