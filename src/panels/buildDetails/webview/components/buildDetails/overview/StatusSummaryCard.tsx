import { BuildResultStatusIcon } from "../../../../../shared/webview/components/BuildResultStatusIcon";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { Card, CardContent, CardHeader } from "../../../../../shared/webview/components/ui/card";
import { TerminalIcon, TestTubeIcon, WorkflowIcon } from "../../../../../shared/webview/icons";
import {
  resolveBuildResultBorderColor,
  resolveBuildResultGraphBackground,
  resolveResultIconTextClass
} from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildDetailsTab } from "../../../hooks/useBuildDetailsTabs";
import { BuildDetailsMetaFields } from "../BuildDetailsMetaFields";
import { StatusPill } from "../StatusPill";

type StatusSummaryCardProps = {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  hasPipelineStages: boolean;
  hasTests: boolean;
  onNavigateTab: (tab: BuildDetailsTab) => void;
};
export function StatusSummaryCard({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel,
  hasPipelineStages,
  hasTests,
  onNavigateTab
}: StatusSummaryCardProps): JSX.Element {
  return (
    <Card
      className="overflow-hidden border-l-2"
      style={{
        borderLeftColor: resolveBuildResultBorderColor(resultClass),
        background: resolveBuildResultGraphBackground(resultClass)
      }}
    >
      <CardHeader className="gap-3 pb-0">
        <div className="flex items-center gap-3 min-w-0">
          <BuildResultStatusIcon
            status={resultClass}
            className={cn("h-8 w-8 shrink-0", resolveResultIconTextClass(resultClass))}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold truncate">{displayName}</span>
              <StatusPill label={resultLabel} status={resultClass} />
            </div>
            <BuildDetailsMetaFields
              durationLabel={durationLabel}
              timestampLabel={timestampLabel}
              culpritsLabel={culpritsLabel}
              showSeparators={false}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-3 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {hasPipelineStages ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onNavigateTab("pipeline")}
            >
              <WorkflowIcon className="h-3.5 w-3.5" />
              Pipeline
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onNavigateTab("console")}
          >
            <TerminalIcon className="h-3.5 w-3.5" />
            Console
          </Button>
          {hasTests ? (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onNavigateTab("tests")}
            >
              <TestTubeIcon className="h-3.5 w-3.5" />
              Tests
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
