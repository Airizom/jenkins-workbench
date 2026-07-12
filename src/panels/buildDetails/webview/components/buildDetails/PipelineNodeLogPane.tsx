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
import type { ConsoleHtmlModel } from "../../lib/consoleHtml";
import { ConsoleLogViewer } from "./ConsoleLogViewer";

const { useState } = React;
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
  const consoleUrl = log.consoleUrl;

  if (!log.target) {
    return (
      <aside className="rounded border border-dashed border-mutedBorder bg-muted-soft px-3 py-4 text-sm text-muted-foreground">
        Select a stage or step log from the pipeline.
      </aside>
    );
  }
  const target = log.target;

  return (
    <aside className="rounded border border-card-border bg-card shadow-widget">
      <ConsoleLogViewer
        text={log.text}
        htmlModel={htmlModel}
        truncated={log.truncated}
        maxChars={0}
        error={log.error}
        followLog={followLog}
        isActive={isActive}
        scrollKeyPrefix={target.key}
        bodyClassName="space-y-2 p-3"
        onOpenExternal={onOpenExternal}
        renderHeader={({ hasOutput, lineCount, openSearchToolbar }) => (
          <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {target.kind === "stage" ? "Stage Log" : "Step Log"}
              </div>
              <div className="truncate text-sm font-semibold">{target.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {log.loading ? "Loading" : `${lineCount.toLocaleString()} lines`}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={openSearchToolbar}>
                    <SearchIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search log</TooltipContent>
              </Tooltip>
              {consoleUrl ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => onOpenExternal(consoleUrl)}>
                      <ExternalLinkIcon className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open in Jenkins</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={!hasOutput} onClick={onExport}>
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export log</TooltipContent>
              </Tooltip>
              <div className="mx-1 h-5 w-px bg-border" />
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Switch
                  id="pipeline-node-log-follow"
                  checked={followLog}
                  onCheckedChange={setFollowLog}
                />
                <label htmlFor="pipeline-node-log-follow" className="select-none">
                  Follow
                </label>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={onClear}>
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
