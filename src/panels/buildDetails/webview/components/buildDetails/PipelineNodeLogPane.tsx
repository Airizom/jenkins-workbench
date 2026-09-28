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

const { useEffect, useState } = React;
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
  const consoleUrl = log.consoleUrl;

  // Each newly selected node starts out following its latest output.
  useEffect(() => {
    if (targetKey) {
      setFollowLog(true);
    }
  }, [targetKey]);

  if (!log.target) {
    return (
      <aside ref={paneRef} className="pipeline-log-pane" aria-label="Pipeline log">
        <EmptyState
          icon={<TerminalIcon className="h-4 w-4" />}
          title="No log selected"
          description="Choose a stage or step in the pipeline to stream its log here."
          className="py-6"
        />
      </aside>
    );
  }
  const target = log.target;
  const kindLabel = target.kind === "stage" ? "Stage" : "Step";
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
        renderHeader={({ hasOutput, lineCount, openSearchToolbar }) => (
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {kindLabel} Log
              </div>
              <h3
                ref={headingRef}
                tabIndex={-1}
                className="m-0 truncate text-sm font-semibold focus:outline-none focus-visible:outline-1 focus-visible:outline-ring"
                title={targetName}
              >
                {targetName}
              </h3>
              <div className="text-[11px] text-muted-foreground">
                {log.loading ? "Loading" : `${lineCount.toLocaleString()} lines`}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Search ${kindLabel.toLowerCase()} log`}
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
                    aria-label={`Export ${kindLabel.toLowerCase()} log`}
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
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Switch
                      id="pipeline-node-log-follow"
                      checked={followLog}
                      onCheckedChange={setFollowLog}
                    />
                    <label
                      htmlFor="pipeline-node-log-follow"
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
                  <Button variant="ghost" size="icon" aria-label="Close log" onClick={onClear}>
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
