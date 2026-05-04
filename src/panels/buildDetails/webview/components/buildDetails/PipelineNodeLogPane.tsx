import * as React from "react";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Switch } from "../../../../shared/webview/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import {
  DownloadIcon,
  ExternalLinkIcon,
  SearchIcon,
  XIcon
} from "../../../../shared/webview/icons";
import type { PipelineNodeLogViewModel } from "../../../shared/BuildDetailsContracts";
import { useConsoleOutputScroll } from "../../hooks/useConsoleOutputScroll";
import { useConsoleSearch } from "../../hooks/useConsoleSearch";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { renderConsoleHtmlWithHighlights } from "../../lib/consoleHtml";
import { ConsoleSearchToolbar } from "../ConsoleSearchToolbar";
import {
  ConsoleOutputEmptyState,
  ConsoleOutputErrorNotice,
  ConsoleOutputNotice,
  ConsoleOutputViewport
} from "./consoleOutput";
import { buildConsoleTruncationNote, countConsoleLines } from "./consoleOutput/consoleOutputUtils";

const { useEffect, useMemo, useState } = React;

export function PipelineNodeLogPane({
  log,
  htmlModel,
  onClear,
  onExport,
  onOpenExternal,
  isActive
}: {
  log: PipelineNodeLogViewModel;
  htmlModel?: ConsoleHtmlModel;
  onClear: () => void;
  onExport: () => void;
  onOpenExternal: (url: string) => void;
  isActive: boolean;
}) {
  const [followLog, setFollowLog] = useState(true);
  const sourceText = htmlModel?.text ?? log.text;
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
  const scrollKey = `${log.target?.key ?? "none"}-${sourceText.length}-${log.error ?? ""}`;
  const { showScrollToTop, scrollConsoleToBottom, scrollConsoleToTop } = useConsoleOutputScroll(
    consoleSearch.consoleOutputRef,
    scrollKey
  );
  const hasOutput = sourceText.length > 0;
  const lineCount = useMemo(() => countConsoleLines(sourceText), [sourceText]);
  const note = useMemo(() => buildConsoleTruncationNote(log.truncated, 0), [log.truncated]);
  const consoleUrl = log.consoleUrl;

  useEffect(() => {
    if (!isActive || !followLog || consoleSearch.isSearchActive) {
      return;
    }
    scrollConsoleToBottom();
  }, [isActive, followLog, scrollKey, consoleSearch.isSearchActive, scrollConsoleToBottom]);

  if (!log.target) {
    return (
      <aside className="rounded border border-dashed border-mutedBorder bg-muted-soft px-3 py-4 text-sm text-muted-foreground">
        Select a stage or step log from the pipeline.
      </aside>
    );
  }

  return (
    <aside className="rounded border border-card-border bg-card shadow-widget">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {log.target.kind === "stage" ? "Stage Log" : "Step Log"}
          </div>
          <div className="truncate text-sm font-semibold">{log.target.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {log.loading ? "Loading" : `${lineCount.toLocaleString()} lines`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={consoleSearch.openSearchToolbar}>
                <SearchIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search log</TooltipContent>
          </Tooltip>
          {consoleUrl ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={() => onOpenExternal(consoleUrl)}>
                  <ExternalLinkIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open in Jenkins</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled={!hasOutput} onClick={onExport}>
                <DownloadIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export log</TooltipContent>
          </Tooltip>
          <div className="mx-1 h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Switch checked={followLog} onCheckedChange={setFollowLog} />
            <span>Follow</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onClear}>
                <XIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Close log</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-2 p-3">
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
        <ConsoleOutputNotice note={note} />
        <ConsoleOutputErrorNotice error={log.error} />
        {!log.error && hasOutput ? (
          <ConsoleOutputViewport
            consoleOutputRef={consoleSearch.consoleOutputRef}
            showScrollToTop={showScrollToTop}
            followLog={followLog}
            onScrollToTop={scrollConsoleToTop}
            segments={segments}
          />
        ) : null}
        {!log.error && !hasOutput ? <ConsoleOutputEmptyState /> : null}
      </div>
    </aside>
  );
}
