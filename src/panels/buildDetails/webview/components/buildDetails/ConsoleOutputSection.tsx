import * as React from "react";
import type { ChangeEvent } from "react";
import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Card, CardContent, CardHeader } from "../../../../shared/webview/components/ui/card";
import { Switch } from "../../../../shared/webview/components/ui/switch";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";
import { stripAnsi } from "../../lib/ansi";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { ConsoleSearchToolbar } from "../ConsoleSearchToolbar";

const { useCallback, useEffect, useMemo } = React;

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="6" />
      <line x1="15.5" y1="15.5" x2="20" y2="20" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
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

function TerminalIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
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

  useEffect(() => {
    if (!isActive || !followLog || consoleSearch.isSearchActive) {
      return;
    }
    if (consoleScrollKey || consoleScrollKey === "") {
      scrollConsoleToBottom();
    }
  }, [isActive, followLog, consoleScrollKey, consoleSearch.isSearchActive, scrollConsoleToBottom]);

  const consoleNote = useMemo(() => {
    if (!consoleTruncated) {
      return "";
    }
    const maxChars = Number.isFinite(consoleMaxChars) ? consoleMaxChars : 0;
    return `Showing last ${maxChars.toLocaleString()} characters of console output.`;
  }, [consoleTruncated, consoleMaxChars]);

  const hasConsoleOutput = consoleSourceText.length > 0;
  const lineCount = useMemo(() => {
    if (!hasConsoleOutput) {
      return 0;
    }
    return consoleSourceText.split("\n").length;
  }, [consoleSourceText, hasConsoleOutput]);

  const handleFollowLogChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.checked;
    onToggleFollowLog(nextValue);
    if (nextValue && isActive && !consoleSearch.isSearchActive) {
      scrollConsoleToBottom();
    }
  };

  const handleExportLogs = () => {
    onExportLogs();
  };

  return (
    <Card>
      <CardHeader className="space-y-0 pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                <TerminalIcon />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Console Output</h3>
                {hasConsoleOutput ? (
                  <p className="text-xs text-muted-foreground">
                    {lineCount.toLocaleString()} lines
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                aria-label="Search console output"
                onClick={consoleSearch.openSearchToolbar}
                size="sm"
                variant="outline"
                title="Search (Cmd/Ctrl+F)"
                className="gap-1.5"
              >
                <SearchIcon />
                <span className="hidden sm:inline">Search</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportLogs}
                className="gap-1.5"
                aria-label="Export console output"
              >
                <DownloadIcon />
                <span className="hidden sm:inline">Export</span>
              </Button>
              <div className="flex items-center gap-2 rounded border border-border bg-muted/50 px-2.5 py-1">
                <Switch id="follow-log" checked={followLog} onChange={handleFollowLogChange} />
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
              className="flex items-center gap-2 rounded bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
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
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {consoleError ? (
          <Alert id="console-error" variant="warning">
            <AlertDescription className="text-[13px]">{consoleError}</AlertDescription>
          </Alert>
        ) : null}

        {!consoleError && hasConsoleOutput ? (
          <div className="relative">
            <pre
              id="console-output"
              ref={consoleSearch.consoleOutputRef}
              className="m-0 rounded border border-border bg-muted px-4 py-3 font-mono text-vscode-editor leading-relaxed whitespace-pre overflow-x-auto max-h-[600px] overflow-y-auto"
            >
              {consoleSegments}
            </pre>
          </div>
        ) : null}

        {!consoleError && !hasConsoleOutput ? (
          <div
            id="console-empty"
            className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-border px-4 py-8 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <TerminalIcon />
            </div>
            <div className="text-sm text-muted-foreground">No console output available</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
