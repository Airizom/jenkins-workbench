import { BuildResultStatusIcon } from "../../../../../shared/webview/components/BuildResultStatusIcon";
import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../../shared/webview/components/ui/button";
import { Progress } from "../../../../../shared/webview/components/ui/progress";
import { ExternalLinkIcon } from "../../../../../shared/webview/icons";
import {
  resolveBuildResultBorderColor,
  resolveBuildResultGraphBackground,
  resolveResultBadgeClass,
  resolveResultIconTextClass,
  resolveStatusAccentClass
} from "../../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildTestsSummaryViewModel } from "../../../../shared/BuildDetailsContracts";
import { BuildDetailsMetaFields } from "../BuildDetailsMetaFields";
import { StatusPill } from "../StatusPill";

function describeTestsPill(
  summary: BuildTestsSummaryViewModel
): { label: string; className: string } | undefined {
  if (!summary.hasAnyResults || summary.totalCount === 0) {
    return undefined;
  }
  if (summary.failedCount > 0) {
    return {
      label: `${summary.failedCount} failed of ${summary.totalCount} tests`,
      className: "border-failure-border bg-failure-soft text-failure"
    };
  }
  return {
    label: `${summary.passedCount}/${summary.totalCount} tests`,
    className: "border-success-border bg-success-soft text-success"
  };
}

type BuildStatusHeroProps = {
  displayName: string;
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  loading: boolean;
  isRunning: boolean;
  buildUrl?: string;
  testsSummary: BuildTestsSummaryViewModel;
  stageCount: number;
  onOpenBuild: () => void;
  children?: React.ReactNode;
};
export function BuildStatusHero({
  displayName,
  resultLabel,
  resultClass,
  durationLabel,
  timestampLabel,
  culpritsLabel,
  loading,
  isRunning,
  buildUrl,
  testsSummary,
  stageCount,
  onOpenBuild,
  children
}: BuildStatusHeroProps): JSX.Element {
  const testsPill = describeTestsPill(testsSummary);

  return (
    <header className="sticky-header">
      {isRunning || loading ? <Progress indeterminate className="h-px rounded-none" /> : null}
      <div
        style={{
          background: resolveBuildResultGraphBackground(resultClass),
          borderBottom: `1px solid ${resolveBuildResultBorderColor(resultClass)}`
        }}
      >
        <div className="mx-auto max-w-6xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                  resolveResultBadgeClass(resultClass),
                  isRunning && "hero-status-glyph--running"
                )}
              >
                <BuildResultStatusIcon
                  status={resultClass}
                  className={cn("h-6 w-6", resolveResultIconTextClass(resultClass))}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <h1
                    className="text-base sm:text-lg font-semibold leading-tight truncate"
                    id="detail-title"
                  >
                    {displayName}
                  </h1>
                  <StatusPill id="detail-result" label={resultLabel} status={resultClass} />
                </div>
                <BuildDetailsMetaFields
                  durationLabel={durationLabel}
                  timestampLabel={timestampLabel}
                  culpritsLabel={culpritsLabel}
                  className="hidden sm:flex items-center gap-2 mt-1 text-xs text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {testsPill ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "hidden sm:inline-flex text-[11px] font-medium",
                    testsPill.className
                  )}
                >
                  {testsPill.label}
                </Badge>
              ) : null}
              {stageCount > 0 ? (
                <Badge
                  variant="outline"
                  className="hidden sm:inline-flex text-[11px] font-medium border-border bg-muted-soft text-muted-foreground"
                >
                  {stageCount === 1 ? "1 stage" : `${stageCount} stages`}
                </Badge>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenBuild}
                disabled={!buildUrl}
                aria-label="Open in Jenkins"
                className="gap-1.5 h-7 px-2.5 text-xs"
              >
                <ExternalLinkIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Open in Jenkins</span>
              </Button>
            </div>
          </div>
          <BuildDetailsMetaFields
            idSuffix="-sm"
            durationLabel={durationLabel}
            timestampLabel={timestampLabel}
            culpritsLabel={culpritsLabel}
            className="sm:hidden flex items-center gap-2 mt-2 text-xs text-muted-foreground"
          />
        </div>
        {children}
      </div>
      <div className={cn("h-0.5", resolveStatusAccentClass(resultClass))} />
    </header>
  );
}
