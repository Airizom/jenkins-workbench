import * as React from "react";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import { PlayIcon, TerminalIcon, WorkflowIcon } from "../../../../../shared/webview/icons";
import type { PipelineStageViewModel } from "../../../../shared/BuildDetailsContracts";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { hasMetaValue } from "../BuildDetailsMetaFields";
import { extractConsoleTail, findRunningStages } from "./runningProgressModel";

const CONSOLE_TAIL_LINES = 6;

const { useMemo } = React;

type RunningProgressCardProps = {
  pipelineStages: PipelineStageViewModel[];
  consoleText: string;
  hasPipelineStages: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
};

/** What a running build is doing right now: active stages and its latest output. */
export function RunningProgressCard({
  pipelineStages,
  consoleText,
  hasPipelineStages,
  onNavigateTab
}: RunningProgressCardProps): React.JSX.Element {
  const runningStages = useMemo(() => findRunningStages(pipelineStages), [pipelineStages]);
  const tail = useMemo(() => extractConsoleTail(consoleText, CONSOLE_TAIL_LINES), [consoleText]);

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2 pb-3">
        <PlayIcon className="h-3.5 w-3.5 text-info" />
        <CardTitle>Now running</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {runningStages.length > 0 ? (
          <ul className="list-none space-y-1 p-0">
            {runningStages.map((stage) => (
              <li key={stage.key} className="text-sm">
                <span className="font-medium">{stage.name}</span>
                {hasMetaValue(stage.durationLabel) ? (
                  <span className="text-xs text-muted-foreground"> · {stage.durationLabel}</span>
                ) : null}
                {stage.branchNames.length > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Branches: {stage.branchNames.join(", ")}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {tail.length > 0 ? (
          <figure className="space-y-1">
            <figcaption className="text-caption text-muted-foreground">Latest output</figcaption>
            <pre className="overflow-x-auto whitespace-pre rounded border border-border bg-terminal px-3 py-2 font-mono text-xs leading-relaxed text-terminal-foreground">
              {tail.join("\n")}
            </pre>
          </figure>
        ) : (
          <p className="text-xs text-muted-foreground">Waiting for console output.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => onNavigateTab("console")}>
            <TerminalIcon className="h-3.5 w-3.5" />
            View console
          </Button>
          {hasPipelineStages ? (
            <Button variant="secondary" size="sm" onClick={() => onNavigateTab("pipeline")}>
              <WorkflowIcon className="h-3.5 w-3.5" />
              View pipeline
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
