import * as React from "react";
import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Switch } from "../../../../shared/webview/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import { ArrowUpIcon } from "../../../../shared/webview/icons";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";
import { stripAnsi } from "../../lib/ansi";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { ConsoleSearchToolbar } from "../ConsoleSearchToolbar";

const { useCallback, useEffect, useMemo, useState } = React;

const CONSOLE_SCROLL_THRESHOLD_PX = 24;

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

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
  const [showScrollToTop, setShowScrollToTop] = useState(false);

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

  const updateConsoleScrollState = useCallback(() => {
    const output = consoleSearch.consoleOutputRef.current;
    if (!output) {
      setShowScrollToTop(false);
      return;
    }
    const { scrollTop, clientHeight, scrollHeight } = output;
    const isScrollable = scrollHeight - clientHeight > 1;
    const isScrolledDown = scrollTop > CONSOLE_SCROLL_THRESHOLD_PX;
    setShowScrollToTop(isScrollable && isScrolledDown);
  }, [consoleSearch.consoleOutputRef]);

  useEffect(() => {
    const output = consoleSearch.consoleOutputRef.current;
    if (!output) {
      return undefined;
    }
    updateConsoleScrollState();

    const handleScroll = () => updateConsoleScrollState();
    const handleResize = () => updateConsoleScrollState();

    output.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);

    return () => {
      output.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [consoleSearch.consoleOutputRef, consoleScrollKey, updateConsoleScrollState]);

  const scrollConsoleToBottom = useCallback(() => {
    const output = consoleSearch.consoleOutputRef.current;
    if (!output) {
      return;
    }
    requestAnimationFrame(() => {
      const target = consoleSearch.consoleOutputRef.current;
      if (!target) {
        return;
      }
      target.scrollTo({ top: target.scrollHeight, behavior: "auto" });
    });
  }, [consoleSearch.consoleOutputRef]);

  const scrollConsoleToTop = useCallback(() => {
    const output = consoleSearch.consoleOutputRef.current;
    if (!output) {
      return;
    }
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    output.scrollTo({ top: 0, behavior });
  }, [consoleSearch.consoleOutputRef]);

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

  const consoleNote = useMemo(() => {
    if (!consoleTruncated) {
      return "";
    }
    const maxChars = Number.isFinite(consoleMaxChars) ? consoleMaxChars : 0;
    return `Showing last ${maxChars.toLocaleString()} characters.`;
  }, [consoleTruncated, consoleMaxChars]);

  const hasConsoleOutput = consoleSourceText.length > 0;
  const lineCount = useMemo(() => {
    if (!hasConsoleOutput) {
      return 0;
    }
    let count = 1;
    for (let index = 0; index < consoleSourceText.length; index += 1) {
      if (consoleSourceText.charCodeAt(index) === 10) {
        count += 1;
      }
    }
    return count;
  }, [consoleSourceText, hasConsoleOutput]);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Console
            {hasConsoleOutput ? ` · ${lineCount.toLocaleString()} lines` : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            aria-label="Search console output"
            onClick={consoleSearch.openSearchToolbar}
            size="sm"
            variant="outline"
            className="gap-1.5 h-7 px-2 text-xs"
          >
            <SearchIcon className="h-3.5 w-3.5" />
            Search
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportLogs}
            className="gap-1.5 h-7 px-2 text-xs"
            aria-label="Export console output"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            Export
          </Button>
          <div className="flex items-center gap-1.5 ml-0.5 pl-1.5 border-l border-border">
            <Switch
              id="follow-log"
              checked={followLog}
              onCheckedChange={handleFollowLogChange}
            />
            <label
              htmlFor="follow-log"
              className="text-xs text-muted-foreground select-none whitespace-nowrap"
            >
              Follow
            </label>
          </div>
        </div>
      </div>

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

      {consoleNote ? (
        <div
          id="console-note"
          className="flex items-center gap-1.5 rounded border border-warning-border bg-warning-surface px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          {consoleNote}
        </div>
      ) : null}

      {consoleError ? (
        <Alert id="console-error" variant="warning" className="py-2">
          <AlertDescription className="text-xs">{consoleError}</AlertDescription>
        </Alert>
      ) : null}

      {!consoleError && hasConsoleOutput ? (
        <div className="relative">
          <pre
            id="console-output"
            ref={consoleSearch.consoleOutputRef}
            className="console-output m-0 rounded border border-border bg-terminal px-3 py-2 font-mono text-terminal-foreground text-vscode-editor leading-relaxed shadow-inner whitespace-pre overflow-x-auto overflow-y-auto"
          >
            {consoleSegments}
          </pre>
          {showScrollToTop && !followLog ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Scroll console to top"
                  className="absolute bottom-2 right-2 z-10 rounded-full shadow-widget h-7 w-7"
                  onClick={scrollConsoleToTop}
                  size="icon"
                  variant="secondary"
                >
                  <ArrowUpIcon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Scroll to top</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {!consoleError && !hasConsoleOutput ? (
        <div
          id="console-empty"
          className="flex items-center justify-center gap-2 rounded border border-dashed border-border bg-muted-soft px-3 py-6 text-center"
        >
          <TerminalIcon />
          <span className="text-xs text-muted-foreground">No console output available</span>
        </div>
      ) : null}
    </div>
  );
}
