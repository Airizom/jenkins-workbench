import {
  type CoverageStatusClass,
  coverageStatusClassToVisualTone,
  resolveCoverageStatusClass,
  resolveMetricToneClass
} from "../../../../../shared/TestStatusStyles";
import { CoverageStatusBadge } from "../../../../../shared/webview/components/CoverageStatusBadge";
import { MetricsSummarySection } from "../../../../../shared/webview/components/MetricsSummarySection";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { FileIcon } from "../../../../../shared/webview/icons";
import { cn } from "../../../../../shared/webview/lib/utils";
import type { BuildDetailsCoverageStateViewModel } from "../../../../shared/BuildDetailsContracts";

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
      <MetricsSummarySection
        icon={<FileIcon className="h-4 w-4" />}
        title="Coverage"
        badge={
          coverageState.overallQualityGateStatusLabel ? (
            <CoverageStatusBadge
              label={coverageState.overallQualityGateStatusLabel}
              statusClass={coverageState.overallQualityGateStatusClass}
            />
          ) : undefined
        }
        description="Coverage plugin summary for this completed build."
        metrics={
          <>
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
            <ToneMetricCard
              label="Quality Gates"
              value={
                coverageState.qualityGates.length > 0
                  ? String(coverageState.qualityGates.length)
                  : undefined
              }
              tone={coverageStatusClassToVisualTone(
                resolveCoverageStatusClass(coverageState.overallQualityGateStatusClass)
              )}
            />
          </>
        }
        footer={
          coverageState.status === "loading" || coverageState.status === "idle" ? (
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
                        <CoverageStatusBadge
                          label={qualityGate.statusLabel}
                          statusClass={qualityGate.statusClass}
                        />
                        {qualityGate.valueLabel ? (
                          <span>Value {qualityGate.valueLabel}</span>
                        ) : null}
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
                        <CoverageLineCount
                          label="Covered"
                          value={file.coveredCount}
                          tone="success"
                        />
                        <CoverageLineCount label="Missed" value={file.missedCount} tone="failure" />
                        <CoverageLineCount
                          label="Partial"
                          value={file.partialCount}
                          tone="warning"
                        />
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
          )
        }
      />
    </section>
  );
}

function CoverageLineCount({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: Exclude<CoverageStatusClass, "neutral">;
}) {
  return (
    <div className="text-xs text-muted-foreground">
      <span
        className={cn("font-medium", resolveMetricToneClass(coverageStatusClassToVisualTone(tone)))}
      >
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </div>
  );
}
