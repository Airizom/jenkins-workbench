import type * as React from "react";
import { resolveCoverageStatusBadgeClass } from "../../../../../shared/TestStatusStyles";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { Button } from "../../../../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../../../../../shared/webview/components/ui/card";
import { FileIcon } from "../../../../../shared/webview/icons";
import type { BuildDetailsCoverageStateViewModel } from "../../../../shared/BuildDetailsContracts";

type CoverageGlanceCardProps = {
  coverageState: BuildDetailsCoverageStateViewModel;
  /** Coverage is only fetched once the build completes. */
  isRunning?: boolean;
  onShowTests?: () => void;
};
export function CoverageGlanceCard({
  coverageState,
  isRunning = false,
  onShowTests
}: CoverageGlanceCardProps): React.JSX.Element | null {
  if (coverageState.status === "disabled") {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <FileIcon className="h-4 w-4" />
          <CardTitle>Coverage</CardTitle>
        </div>
        {coverageState.overallQualityGateStatusLabel ? (
          <ToneBadge
            label={coverageState.overallQualityGateStatusLabel}
            className={resolveCoverageStatusBadgeClass(coverageState.overallQualityGateStatusClass)}
          />
        ) : null}
      </CardHeader>
      <CardContent className="pb-4">
        {renderCoverageContent(coverageState, isRunning)}
        {onShowTests ? (
          <Button
            variant="link"
            size="sm"
            className="mt-3 text-xs"
            onClick={onShowTests}
            title="Opens the Tests tab"
          >
            View coverage details
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

const COVERAGE_AFTER_COMPLETION_MESSAGE = "Coverage is available after the build completes.";

function renderCoverageContent(
  coverageState: BuildDetailsCoverageStateViewModel,
  isRunning: boolean
): React.JSX.Element {
  const pending = coverageState.status === "loading" || coverageState.status === "idle";
  if (pending && isRunning) {
    return (
      <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
        {COVERAGE_AFTER_COMPLETION_MESSAGE}
      </div>
    );
  }
  if (pending) {
    return (
      <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
        Loading coverage results for this build.
      </div>
    );
  }

  if (coverageState.status === "error") {
    return (
      <div className="rounded border border-failure-border-subtle bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
        Coverage data could not be loaded for this build.
        {coverageState.errorMessage ? ` ${coverageState.errorMessage}` : ""}
      </div>
    );
  }

  if (coverageState.status === "unavailable") {
    return (
      <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
        Coverage data is unavailable for this build.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <ToneMetricCard label="Project" value={coverageState.projectCoverage} tone="neutral" />
      <ToneMetricCard
        label="Modified Files"
        value={coverageState.modifiedFilesCoverage}
        tone="neutral"
      />
      <ToneMetricCard
        label="Modified Lines"
        value={coverageState.modifiedLinesCoverage}
        tone="neutral"
      />
    </div>
  );
}
