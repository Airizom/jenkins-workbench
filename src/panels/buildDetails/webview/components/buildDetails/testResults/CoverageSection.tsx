import { Badge } from "../../../../../shared/webview/components/ui/badge";
import { FileIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildDetailsCoverageStateViewModel } from "../../../../shared/BuildDetailsContracts";
import type { CoverageTone } from "./testResultsTypes";
import {
  coverageStatusBadgeClassName,
  coverageToneClassName,
  mapToneToMetricTone,
  metricCardClassName,
  toCoverageTone
} from "./testResultsUtils";

export function CoverageSection({
  coverageState
}: {
  coverageState: BuildDetailsCoverageStateViewModel;
}) {
  if (coverageState.status === "disabled") {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="rounded border border-border bg-muted-soft p-3 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-background">
              <FileIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Coverage</span>
                {coverageState.overallQualityGateStatusLabel ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      coverageStatusBadgeClassName(coverageState.overallQualityGateStatusClass)
                    )}
                  >
                    {coverageState.overallQualityGateStatusLabel}
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                Coverage plugin summary for this completed build.
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CoverageMetricCard
              label="Project"
              value={coverageState.projectCoverage}
              tone="success"
            />
            <CoverageMetricCard
              label="Modified Files"
              value={coverageState.modifiedFilesCoverage}
              tone="success"
            />
            <CoverageMetricCard
              label="Modified Lines"
              value={coverageState.modifiedLinesCoverage}
              tone="success"
            />
            <CoverageMetricCard
              label="Quality Gates"
              value={
                coverageState.qualityGates.length > 0
                  ? String(coverageState.qualityGates.length)
                  : undefined
              }
              tone={toCoverageTone(coverageState.overallQualityGateStatusClass)}
            />
          </div>
        </div>

        {coverageState.status === "loading" || coverageState.status === "idle" ? (
          <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            Loading coverage results for this build.
          </div>
        ) : coverageState.status === "error" ? (
          <div className="rounded border border-failure-border-subtle bg-background px-3 py-2 text-sm text-muted-foreground">
            Coverage data could not be loaded for this build.
            {coverageState.errorMessage ? ` ${coverageState.errorMessage}` : ""}
          </div>
        ) : coverageState.status === "unavailable" ? (
          <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            Coverage data is unavailable for this build. The coverage plugin or report may be
            missing.
          </div>
        ) : (
          <>
            {coverageState.qualityGates.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {coverageState.qualityGates.map((qualityGate) => (
                  <div
                    key={`${qualityGate.name}:${qualityGate.statusLabel}`}
                    className="rounded border border-border bg-background px-3 py-2 text-xs"
                  >
                    <div className="font-medium text-foreground">{qualityGate.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0",
                          coverageStatusBadgeClassName(qualityGate.statusClass)
                        )}
                      >
                        {qualityGate.statusLabel}
                      </Badge>
                      {qualityGate.valueLabel ? <span>Value {qualityGate.valueLabel}</span> : null}
                      {qualityGate.thresholdLabel ? (
                        <span>Threshold {qualityGate.thresholdLabel}</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {coverageState.modifiedFiles.length > 0 ? (
              <div className="rounded border border-border bg-background">
                <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Modified Files
                </div>
                <div className="divide-y divide-border">
                  {coverageState.modifiedFiles.map((file) => (
                    <div
                      key={file.path}
                      className="grid gap-2 px-3 py-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
                    >
                      <div className="min-w-0 text-sm text-foreground">{file.path}</div>
                      <CoverageLineCount label="Covered" value={file.coveredCount} tone="success" />
                      <CoverageLineCount label="Missed" value={file.missedCount} tone="failure" />
                      <CoverageLineCount label="Partial" value={file.partialCount} tone="warning" />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                Modified-line coverage is unavailable for this build. Summary coverage is still
                shown.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function CoverageMetricCard({
  label,
  value,
  tone
}: {
  label: string;
  value?: string;
  tone: CoverageTone;
}) {
  return (
    <div className={cn("rounded border px-3 py-2", metricCardClassName(mapToneToMetricTone(tone)))}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", coverageToneClassName(tone))}>
        {value ?? "Unavailable"}
      </div>
    </div>
  );
}

function CoverageLineCount({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: Exclude<CoverageTone, "neutral">;
}) {
  return (
    <div className="text-xs text-muted-foreground">
      <span className={cn("font-medium", coverageToneClassName(tone))}>
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </div>
  );
}
