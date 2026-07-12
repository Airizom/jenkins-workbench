import { memo } from "react";
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
import type { BuildDetailsCoverageStateViewModel } from "../../../../shared/BuildDetailsContracts";

const COVERAGE_ICON = <FileIcon className="h-4 w-4" />;
const COVERAGE_LINE_COUNT_CLASS_BY_TONE: Record<Exclude<CoverageStatusClass, "neutral">, string> = {
  success: `font-medium ${resolveMetricToneClass(coverageStatusClassToVisualTone("success"))}`,
  warning: `font-medium ${resolveMetricToneClass(coverageStatusClassToVisualTone("warning"))}`,
  failure: `font-medium ${resolveMetricToneClass(coverageStatusClassToVisualTone("failure"))}`
};

export function CoverageSection({
  coverageState
}: {
  coverageState: BuildDetailsCoverageStateViewModel;
}) {
  const {
    status,
    overallQualityGateStatusLabel,
    overallQualityGateStatusClass,
    projectCoverage,
    modifiedFilesCoverage,
    modifiedLinesCoverage,
    qualityGates,
    modifiedFiles,
    errorMessage
  } = coverageState;

  if (status === "disabled") {
    return null;
  }

  const qualityGateCount = qualityGates.length;
  const hasQualityGates = qualityGateCount > 0;
  const hasModifiedFiles = modifiedFiles.length > 0;

  return (
    <section className="space-y-3">
      <MetricsSummarySection
        icon={COVERAGE_ICON}
        title="Coverage"
        badge={
          overallQualityGateStatusLabel ? (
            <CoverageStatusBadge
              label={overallQualityGateStatusLabel}
              statusClass={overallQualityGateStatusClass}
            />
          ) : undefined
        }
        description="Coverage plugin summary for this completed build."
        metrics={
          <>
            <ToneMetricCard label="Project" value={projectCoverage} tone="neutral" />
            <ToneMetricCard label="Modified Files" value={modifiedFilesCoverage} tone="neutral" />
            <ToneMetricCard label="Modified Lines" value={modifiedLinesCoverage} tone="neutral" />
            <ToneMetricCard
              label="Quality Gates"
              value={hasQualityGates ? String(qualityGateCount) : undefined}
              tone={coverageStatusClassToVisualTone(
                resolveCoverageStatusClass(overallQualityGateStatusClass)
              )}
            />
          </>
        }
        footer={
          status === "loading" || status === "idle" ? (
            <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
              Loading coverage results for this build.
            </div>
          ) : status === "error" ? (
            <div className="rounded border border-failure-border-subtle bg-background px-3 py-2 text-sm text-muted-foreground">
              Coverage data could not be loaded for this build.
              {errorMessage ? ` ${errorMessage}` : ""}
            </div>
          ) : status === "unavailable" ? (
            <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
              Coverage data is unavailable for this build. The coverage plugin or report may be
              missing.
            </div>
          ) : (
            <>
              {hasQualityGates ? (
                <div className="flex flex-wrap gap-2">
                  {qualityGates.map((qualityGate) => (
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

              {hasModifiedFiles ? (
                <div className="rounded border border-border bg-background">
                  <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Modified Files
                  </div>
                  <div className="divide-y divide-border">
                    {modifiedFiles.map((file) => (
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

const CoverageLineCount = memo(function CoverageLineCount({
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
      <span className={COVERAGE_LINE_COUNT_CLASS_BY_TONE[tone]}>{value.toLocaleString()}</span>{" "}
      {label}
    </div>
  );
});
