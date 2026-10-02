import * as React from "react";
import { EmptyState } from "../../../../shared/webview/components/EmptyState";
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
  TerminalIcon,
  XIcon
} from "../../../../shared/webview/icons";
import type { PipelineNodeLogViewModel } from "../../../shared/BuildDetailsContracts";
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { ConsoleLogViewer } from "./ConsoleLogViewer";

const { useEffect, useId, useRef, useState } = React;
export function PipelineNodeLogPane({
  log,
  htmlModel,
  canFollow,
  paneRef,
  headingRef,
  onClear,
  onExport,
  onRetry,
  onOpenExternal,
  isActive
}: {
  log: PipelineNodeLogViewModel;
  htmlModel?: ConsoleHtmlModel;
  /** True while the selected node can still produce output. */
  canFollow: boolean;
  paneRef?: React.Ref<HTMLElement>;
  headingRef?: React.Ref<HTMLHeadingElement>;
  onClear: () => void;
  onExport: () => void;
  onRetry?: () => void;
  onOpenExternal: (url: string) => void;
  isActive: boolean;
}) {
  const targetKey = log.target?.key;
  const [followLog, setFollowLog] = useState(true);
  const followId = useId();
  const emptyStateRef = useRef<HTMLDivElement>(null);
  const closeRequestedRef = useRef(false);
  const consoleUrl = log.consoleUrl;

  // Each newly selected node starts out following its latest output.
  useEffect(() => {
    if (targetKey) {
      setFollowLog(true);
    }
  }, [targetKey]);

  // Closing unmounts the Close button; once the host clears the target, move
  // focus to the empty state unless the user already focused something else.
  useEffect(() => {
    if (!closeRequestedRef.current) {
      return;
    }
    closeRequestedRef.current = false;
    const active = document.activeElement;
    if (!targetKey && (!active || active === document.body)) {
      emptyStateRef.current?.focus();
    }
  }, [targetKey]);

  const handleClose = () => {
    closeRequestedRef.current = true;
    onClear();
  };

  if (!log.target) {
    return (
      <aside ref={paneRef} className="pipeline-log-pane" aria-label="Pipeline log">
        <div
          ref={emptyStateRef}
          tabIndex={-1}
          className="rounded-lg focus:outline-none focus-visible:outline-1 focus-visible:outline-ring"
        >
          <EmptyState
            icon={<TerminalIcon className="h-4 w-4" />}
            title="No log selected"
            description="Choose a stage or step in the pipeline to stream its log here."
            className="py-6"
          />
        </div>
      </aside>
    );
  }
  const target = log.target;
  const kindLabel = target.kind === "stage" ? "Stage" : "Step";
  const kindNoun = target.kind === "stage" ? "stage" : "step";
  const targetName = target.name;

  return (
    <aside
      ref={paneRef}
      aria-label={`${kindLabel} log: ${targetName}`}
      className="pipeline-log-pane overflow-hidden rounded-lg border border-card-border bg-card shadow-sm"
    >
      <ConsoleLogViewer
        text={log.text}
        htmlModel={htmlModel}
        truncated={log.truncated}
        error={log.error}
        loading={log.loading}
        emptyTitle="No log output"
        emptyDescription={
          canFollow
            ? `This ${kindNoun} has not produced any log output yet.`
            : `This ${kindNoun} produced no log output.`
        }
        followLog={followLog}
        canFollow={canFollow}
        onFollowLogChange={setFollowLog}
        isActive={isActive}
        scrollKeyPrefix={target.key}
        bodyClassName="space-y-2 p-3"
        outputLabel={`${kindLabel} log output`}
        finishedAnnouncement={`${kindLabel} finished. Log is complete.`}
        onOpenExternal={onOpenExternal}
        onRetry={onRetry}
        renderHeader={({ hasOutput, lineCount, openSearchToolbar, searchToggleRef }) => (
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                {kindLabel} log
              </div>
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="m-0 truncate text-sm font-semibold focus:outline-none focus-visible:outline-1 focus-visible:outline-ring"
                title={targetName}
              >
                {targetName}
              </h3>
              <div className="text-caption text-muted-foreground">
                {log.loading ? "Loading…" : `${lineCount.toLocaleString()} lines`}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={searchToggleRef}
                    variant="ghost"
                    size="icon"
                    aria-label={`Search ${kindNoun} log`}
                    onClick={openSearchToolbar}
                  >
                    <SearchIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search log</TooltipContent>
              </Tooltip>
              {consoleUrl ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Open in Jenkins"
                      onClick={() => onOpenExternal(consoleUrl)}
                    >
                      <ExternalLinkIcon className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in Jenkins</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Export ${kindNoun} log`}
                    disabled={!hasOutput}
                    onClick={onExport}
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export log</TooltipContent>
              </Tooltip>
              {canFollow ? (
                <>
                  <div className="mx-1 h-5 w-px bg-border" />
                  <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    <Switch id={followId} checked={followLog} onCheckedChange={setFollowLog} />
                    <label
                      htmlFor={followId}
                      className="select-none"
                      title="Keep the newest output in view. Scrolling up pauses Follow."
                    >
                      Follow
                    </label>
                  </div>
                </>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Close log" onClick={handleClose}>
                    <XIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close log</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      />
    </aside>
  );
}
