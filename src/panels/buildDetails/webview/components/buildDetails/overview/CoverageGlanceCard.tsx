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

/** Message for each non-data coverage state; undefined once metrics are ready. */
function describeCoverageNotice(
  coverageState: BuildDetailsCoverageStateViewModel,
  isRunning: boolean
): { message: string; isError: boolean } | undefined {
  const pending = coverageState.status === "loading" || coverageState.status === "idle";
  if (pending) {
    return {
      message: isRunning
        ? "Coverage is available after the build completes."
        : "Loading coverage results for this build.",
      isError: false
    };
  }
  if (coverageState.status === "error") {
    return {
      message: coverageState.errorMessage
        ? `Coverage data could not be loaded for this build. ${coverageState.errorMessage}`
        : "Coverage data could not be loaded for this build.",
      isError: true
    };
  }
  if (coverageState.status === "unavailable") {
    return { message: "Coverage data is unavailable for this build.", isError: false };
  }
  return undefined;
}

function renderCoverageContent(
  coverageState: BuildDetailsCoverageStateViewModel,
  isRunning: boolean
): React.JSX.Element {
  const notice = describeCoverageNotice(coverageState, isRunning);
  if (notice) {
    const borderClass = notice.isError ? "border-failure-border-subtle" : "border-border";
    return (
      <div
        className={`rounded border ${borderClass} bg-muted-soft px-3 py-2 text-xs text-muted-foreground`}
      >
        {notice.message}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <ToneMetricCard label="Project" value={coverageState.projectCoverage} tone="neutral" />
      <ToneMetricCard
        label="Modified files"
        value={coverageState.modifiedFilesCoverage}
        tone="neutral"
      />
      <ToneMetricCard
        label="Modified lines"
        value={coverageState.modifiedLinesCoverage}
        tone="neutral"
      />
    </div>
  );
}
