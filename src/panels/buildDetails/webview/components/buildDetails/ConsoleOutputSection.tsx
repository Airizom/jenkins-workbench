import * as React from "react";
import type { ChangeEvent } from "react";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { ConsoleSearchToolbar } from "../ConsoleSearchToolbar";
import { stripAnsi } from "../../lib/ansi";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";

const { useEffect, useMemo } = React;

export function ConsoleOutputSection({
  consoleText,
  consoleHtmlModel,
  consoleTruncated,
  consoleMaxChars,
  consoleError,
  followLog,
  onToggleFollowLog,
  onExportLogs,
  onOpenExternal,
}: {
  consoleText: string;
  consoleHtmlModel?: ConsoleHtmlModel;
  consoleTruncated: boolean;
  consoleMaxChars: number;
  consoleError?: string;
  followLog: boolean;
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

  useEffect(() => {
    if (!followLog || consoleSearch.isSearchActive) {
      return;
    }
    if (consoleScrollKey || consoleScrollKey === "") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    }
  }, [followLog, consoleScrollKey, consoleSearch.isSearchActive]);

  const consoleNote = useMemo(() => {
    if (!consoleTruncated) {
      return "";
    }
    const maxChars = Number.isFinite(consoleMaxChars) ? consoleMaxChars : 0;
    return `Showing last ${maxChars.toLocaleString()} characters of console output.`;
  }, [consoleTruncated, consoleMaxChars]);

  const hasConsoleOutput = consoleSourceText.length > 0;

  const handleFollowLogChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.checked;
    onToggleFollowLog(nextValue);
    if (nextValue) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    }
  };

  const handleExportLogs = () => {
    onExportLogs();
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CardTitle className="text-base">Console Output</CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              aria-label="Search console output"
              onClick={consoleSearch.openSearchToolbar}
              size="icon"
              variant="ghost"
              title="Search (Cmd/Ctrl+F)"
            >
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
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportLogs}>
              Export Logs
            </Button>
            <div className="flex items-center gap-2">
              <Switch id="follow-log" checked={followLog} onChange={handleFollowLogChange} />
              <label htmlFor="follow-log" className="text-xs text-muted-foreground select-none">
                Follow Log
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
          <div id="console-note" className="text-xs text-muted-foreground">
            {consoleNote}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {consoleError ? (
          <Alert id="console-error" variant="warning">
            <AlertDescription className="text-[13px]">{consoleError}</AlertDescription>
          </Alert>
        ) : null}
        {!consoleError && hasConsoleOutput ? (
          <pre
            id="console-output"
            ref={consoleSearch.consoleOutputRef}
            className="m-0 rounded-lg border border-border bg-background px-4 py-3.5 font-mono text-[length:var(--vscode-editor-font-size)] leading-6 whitespace-pre overflow-x-auto"
          >
            {consoleSegments}
          </pre>
        ) : null}
        {!consoleError && !hasConsoleOutput ? (
          <div
            id="console-empty"
            className="rounded-lg border border-dashed border-border px-3 py-2.5 text-muted-foreground"
          >
            No console output available.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
