import type * as React from "react";
import { ResultBadge } from "../../../../../shared/webview/components/ResultBadge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import { GaugeIcon, TerminalIcon, WorkflowIcon } from "../../../../../shared/webview/icons";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { BuildDetailsMetaFields } from "../BuildDetailsMetaFields";

type OverviewSummaryCardProps = {
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  hasPipelineStages: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
};

/**
 * Fallback for builds that report no tests, coverage, changes, artifacts, or
 * diagnostics, so the default tab is never blank and points somewhere useful.
 */
export function OverviewSummaryCard({
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  hasPipelineStages,
  onNavigateTab
}: OverviewSummaryCardProps): React.JSX.Element {
  const isRunning = resultClass === "running";
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <GaugeIcon className="h-4 w-4" />
          <CardTitle>Build summary</CardTitle>
        </div>
        <ResultBadge label={resultLabel} status={resultClass} />
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <BuildDetailsMetaFields
          idSuffix="-overview"
          durationLabel={durationLabel}
          timestampLabel={timestampLabel}
          culpritsLabel=""
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        />
        <p className="m-0 text-xs text-muted-foreground">
          {isRunning
            ? "Tests, coverage, changes, and artifacts appear here as the build reports them."
            : "This build reported no tests, coverage, changes, or artifacts."}
        </p>
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
