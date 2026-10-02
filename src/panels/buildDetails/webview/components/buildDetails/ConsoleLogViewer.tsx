import * as React from "react";
import type { BuildDiagnosticConsoleReference } from "../../../shared/BuildDetailsContracts";
import { buildConsoleSegments } from "../../hooks/consoleSearch/buildConsoleSegments";
import { prefersReducedMotion, useConsoleOutputScroll } from "../../hooks/useConsoleOutputScroll";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { ConsoleLogSearchBody } from "../ConsoleLogSearchBody";
import { buildConsoleTruncationNote, countConsoleLines } from "./consoleOutput/consoleOutputUtils";

const { useCallback, useEffect, useMemo, useRef, useState } = React;
const EMPTY_SOURCE_REFERENCES: BuildDiagnosticConsoleReference[] = [];

export type ConsoleLogViewerHeaderState = {
  hasOutput: boolean;
  lineCount: number;
  openSearchToolbar: () => void;
  /** Attach to the button that opens search so closing search can refocus it. */
  searchToggleRef: React.RefObject<HTMLButtonElement | null>;
  /** Defined when the console links at least one diagnostic source location. */
  jumpToFirstDiagnostic?: () => void;
};

export function ConsoleLogViewer({
  text,
  htmlModel,
  truncated,
  maxChars,
  error,
  loading,
  emptyTitle,
  emptyDescription,
  followLog,
  canFollow,
  onFollowLogChange,
  isActive,
  scrollKeyPrefix,
  className,
  bodyClassName,
  outputLabel,
  finishedAnnouncement,
  onOpenExternal,
  onRetry,
  sourceReferences = EMPTY_SOURCE_REFERENCES,
  onOpenDiagnosticSource,
  renderHeader
}: {
  text: string;
  htmlModel?: ConsoleHtmlModel;
  truncated: boolean;
  /** Character window applied to the output; omit or pass 0 when unknown. */
  maxChars?: number;
  error?: string;
  /** True while the first chunk of output is being fetched. */
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  followLog: boolean;
  /** True while the output can still grow (running build or node). */
  canFollow: boolean;
  onFollowLogChange?: (value: boolean) => void;
  isActive: boolean;
  scrollKeyPrefix?: string;
  className?: string;
  bodyClassName?: string;
  outputLabel?: string;
  /** Announced once when `canFollow` turns false for the same log. */
  finishedAnnouncement?: string;
  onOpenExternal: (url: string) => void;
  onRetry?: () => void;
  sourceReferences?: BuildDiagnosticConsoleReference[];
  onOpenDiagnosticSource?: (targetId: string) => void;
  renderHeader?: (state: ConsoleLogViewerHeaderState) => React.ReactNode;
}): React.JSX.Element {
  const sourceText = htmlModel?.text ?? text;
  const consoleSearch = useConsoleSearch(sourceText, isActive);
  const consoleOutputRef = consoleSearch.consoleOutputRef;
  const logKey = scrollKeyPrefix ?? "";

  const segments = useMemo(() => {
    if (htmlModel) {
      return renderConsoleHtmlWithHighlights(
        htmlModel,
        consoleSearch.matches,
        consoleSearch.activeMatchIndex,
        onOpenExternal,
        sourceReferences,
        onOpenDiagnosticSource
      );
    }
    return buildConsoleSegments(
      sourceText,
      consoleSearch.matches,
      consoleSearch.activeMatchIndex,
      consoleSearch.isSearchActive,
      sourceReferences,
      onOpenDiagnosticSource
    );
  }, [
    htmlModel,
    consoleSearch.matches,
    consoleSearch.activeMatchIndex,
    consoleSearch.isSearchActive,
    onOpenExternal,
    sourceReferences,
    onOpenDiagnosticSource
  ]);

  const scrollKey = useMemo(() => {
    const sourceKey = `${sourceText.length}-${error ?? ""}`;
    return scrollKeyPrefix ? `${scrollKeyPrefix}-${sourceKey}` : sourceKey;
  }, [scrollKeyPrefix, sourceText, error]);

  // Follow paused by scrolling away (not by the switch) resumes when the user
  // scrolls back to the bottom.
  const autoPausedRef = useRef(false);
  // Last follow value requested from the owner, so repeated scroll events do
  // not post duplicate toggles before the new prop arrives.
  const requestedFollowRef = useRef(followLog);
  // Finished logs have no Follow switch; scrolling away only detaches locally.
  const detachedLogKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    requestedFollowRef.current = followLog;
    if (followLog) {
      autoPausedRef.current = false;
    }
  }, [followLog]);

  const requestFollow = useCallback(
    (value: boolean) => {
      if (requestedFollowRef.current === value) {
        return;
      }
      requestedFollowRef.current = value;
      onFollowLogChange?.(value);
    },
    [onFollowLogChange]
  );

  const { showScrollToTop, isAtBottom, scrollConsoleToBottom, scrollConsoleToTop } =
    useConsoleOutputScroll(consoleOutputRef, scrollKey, {
      onUserScrollAwayFromBottom: () => {
        if (!canFollow) {
          detachedLogKeyRef.current = logKey;
          return;
        }
        if (requestedFollowRef.current) {
          autoPausedRef.current = true;
          requestFollow(false);
        }
      },
      onUserReachBottom: () => {
        if (!canFollow) {
          detachedLogKeyRef.current = undefined;
          return;
        }
        if (autoPausedRef.current && !requestedFollowRef.current) {
          autoPausedRef.current = false;
          requestFollow(true);
        }
      }
    });

  useEffect(() => {
    if (!isActive || !followLog || consoleSearch.isSearchActive) {
      return;
    }
    if (!canFollow && detachedLogKeyRef.current === logKey) {
      return;
    }
    scrollConsoleToBottom();
  }, [
    isActive,
    followLog,
    canFollow,
    logKey,
    scrollKey,
    consoleSearch.isSearchActive,
    scrollConsoleToBottom
  ]);

  const handleJumpToLatest = useCallback(() => {
    autoPausedRef.current = false;
    requestFollow(true);
    scrollConsoleToBottom();
  }, [requestFollow, scrollConsoleToBottom]);

  const note = useMemo(
    () => buildConsoleTruncationNote(truncated, maxChars ?? 0),
    [truncated, maxChars]
  );
  const hasOutput = sourceText.length > 0;
  const lineCount = useMemo(() => countConsoleLines(sourceText), [sourceText]);
  const hasDiagnosticLinks =
    hasOutput && sourceReferences.length > 0 && Boolean(onOpenDiagnosticSource);

  const jumpToFirstDiagnostic = useCallback(() => {
    const output = consoleOutputRef.current;
    const link = output?.querySelector<HTMLElement>(".console-source-link");
    if (!output || !link) {
      return;
    }
    if (canFollow) {
      if (requestedFollowRef.current) {
        autoPausedRef.current = true;
        requestFollow(false);
      }
    } else {
      detachedLogKeyRef.current = logKey;
    }
    const outputRect = output.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    output.scrollTo({
      top: Math.max(0, output.scrollTop + linkRect.top - outputRect.top - output.clientHeight / 3),
      left: Math.max(0, output.scrollLeft + linkRect.left - outputRect.left - 16),
      behavior: prefersReducedMotion() ? "auto" : "smooth"
    });
    link.focus({ preventScroll: true });
  }, [consoleOutputRef, canFollow, logKey, requestFollow]);

  const announcement = useConsoleAnnouncement({
    logKey,
    canFollow,
    truncated,
    note,
    finishedAnnouncement
  });

  return (
    <div className={className}>
      {renderHeader?.({
        hasOutput,
        lineCount,
        openSearchToolbar: consoleSearch.openSearchToolbar,
        searchToggleRef: consoleSearch.searchToggleRef,
        jumpToFirstDiagnostic: hasDiagnosticLinks ? jumpToFirstDiagnostic : undefined
      })}
      <ConsoleLogSearchBody
        className={bodyClassName}
        consoleSearch={consoleSearch}
        note={note}
        error={error}
        hasOutput={hasOutput}
        loading={loading}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        outputLabel={outputLabel}
        showScrollToTop={showScrollToTop && (!canFollow || !followLog)}
        showJumpToLatest={canFollow && !followLog && !isAtBottom && hasOutput}
        onScrollToTop={scrollConsoleToTop}
        onJumpToLatest={handleJumpToLatest}
        onRetry={onRetry}
        segments={segments}
      />
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

// Announces state changes worth interrupting for; streamed lines stay silent.
// Errors are rendered in a role="alert" notice and announce themselves.
function useConsoleAnnouncement({
  logKey,
  canFollow,
  truncated,
  note,
  finishedAnnouncement
}: {
  logKey: string;
  canFollow: boolean;
  truncated: boolean;
  note: string;
  finishedAnnouncement?: string;
}): string {
  const [announcement, setAnnouncement] = useState("");
  const previousRef = useRef({ logKey, canFollow, truncated });

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { logKey, canFollow, truncated };
    if (previous.logKey !== logKey) {
      setAnnouncement("");
      return;
    }
    if (previous.canFollow && !canFollow && finishedAnnouncement) {
      setAnnouncement(finishedAnnouncement);
      return;
    }
    if (!previous.truncated && truncated && note) {
      setAnnouncement(note);
    }
  }, [logKey, canFollow, truncated, note, finishedAnnouncement]);

  return announcement;
}
