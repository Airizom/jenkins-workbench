import { coverageStatusClassToVisualTone } from "../../../../../shared/TestStatusStyles";
import { CoverageStatusBadge } from "../../../../../shared/webview/components/CoverageStatusBadge";
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
  onShowTests?: () => void;
};
export function CoverageGlanceCard({
  coverageState,
  onShowTests
}: CoverageGlanceCardProps): JSX.Element | null {
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
          <CoverageStatusBadge
            label={coverageState.overallQualityGateStatusLabel}
            statusClass={coverageState.overallQualityGateStatusClass}
          />
        ) : null}
      </CardHeader>
      <CardContent className="pb-4">
        {coverageState.status === "loading" || coverageState.status === "idle" ? (
          <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
            Loading coverage results for this build.
          </div>
        ) : coverageState.status === "error" ? (
          <div className="rounded border border-failure-border-subtle bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
            Coverage data could not be loaded for this build.
            {coverageState.errorMessage ? ` ${coverageState.errorMessage}` : ""}
          </div>
        ) : coverageState.status === "unavailable" ? (
          <div className="rounded border border-border bg-muted-soft px-3 py-2 text-xs text-muted-foreground">
            Coverage data is unavailable for this build.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <ToneMetricCard
              label="Project"
              value={coverageState.projectCoverage}
              tone={coverageStatusClassToVisualTone("success")}
            />
            <ToneMetricCard
              label="Modified Files"
              value={coverageState.modifiedFilesCoverage}
              tone={coverageStatusClassToVisualTone("success")}
            />
            <ToneMetricCard
              label="Modified Lines"
              value={coverageState.modifiedLinesCoverage}
              tone={coverageStatusClassToVisualTone("success")}
            />
          </div>
        )}
        {onShowTests ? (
          <Button
            variant="link"
            size="sm"
            className="mt-3 text-xs"
            onClick={onShowTests}
            aria-label="Open the Tests tab for full coverage details"
          >
            View full coverage
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
