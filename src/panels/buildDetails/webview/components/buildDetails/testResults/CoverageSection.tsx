import { type JSX, memo } from "react";
import {
  type CoverageStatusClass,
  coverageStatusClassToVisualTone,
  resolveCoverageStatusBadgeClass,
  resolveCoverageStatusClass,
  resolveMetricToneClass
} from "../../../../../shared/TestStatusStyles";
import { MetricsSummarySection } from "../../../../../shared/webview/components/MetricsSummarySection";
import { ToneBadge } from "../../../../../shared/webview/components/ToneBadge";
import { ToneMetricCard } from "../../../../../shared/webview/components/ToneMetricCard";
import { FileIcon } from "../../../../../shared/webview/icons";
import type { BuildDetailsCoverageStateViewModel } from "../../../../shared/BuildDetailsContracts";

const COVERAGE_ICON = <FileIcon className="h-4 w-4" />;

/**
 * The overall gate result sits beside the build's own result badge, so it is
 * labelled as a gate outcome rather than a second build status.
 */
export function formatQualityGateBadgeLabel(statusLabel: string): string {
  return `Quality gate: ${statusLabel}`;
}

function describeQualityGatesPassed(
  qualityGates: BuildDetailsCoverageStateViewModel["qualityGates"]
): string | undefined {
  if (qualityGates.length === 0) {
    return undefined;
  }
  const passed = qualityGates.filter(
    (gate) => resolveCoverageStatusClass(gate.statusClass) === "success"
  ).length;
  return `${passed} of ${qualityGates.length}`;
}

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
    qualityGates
  } = coverageState;

  if (status === "disabled") {
    return null;
  }

  return (
    <section className="space-y-3">
      <MetricsSummarySection
        icon={COVERAGE_ICON}
        title="Coverage"
        badge={
          overallQualityGateStatusLabel ? (
            <ToneBadge
              label={formatQualityGateBadgeLabel(overallQualityGateStatusLabel)}
              className={resolveCoverageStatusBadgeClass(overallQualityGateStatusClass)}
            />
          ) : undefined
        }
        description="Coverage plugin summary for this completed build."
        metrics={
          <>
            <ToneMetricCard label="Project" value={projectCoverage} tone="neutral" />
            <ToneMetricCard label="Modified files" value={modifiedFilesCoverage} tone="neutral" />
            <ToneMetricCard label="Modified lines" value={modifiedLinesCoverage} tone="neutral" />
            <ToneMetricCard
              label="Gates passed"
              value={describeQualityGatesPassed(qualityGates)}
              tone={coverageStatusClassToVisualTone(
                resolveCoverageStatusClass(overallQualityGateStatusClass)
              )}
            />
          </>
        }
        footer={renderCoverageFooter(coverageState)}
      />
    </section>
  );
}

function renderCoverageFooter(coverageState: BuildDetailsCoverageStateViewModel): JSX.Element {
  const { status, errorMessage, qualityGates, modifiedFiles } = coverageState;

  if (status === "loading" || status === "idle") {
    return (
      <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
        Loading coverage results for this build.
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded border border-failure-border-subtle bg-background px-3 py-2 text-sm text-muted-foreground">
        Coverage data could not be loaded for this build.
        {errorMessage ? ` ${errorMessage}` : ""}
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
        Coverage data is unavailable for this build. The coverage plugin or report may be missing.
      </div>
    );
  }

  return (
    <>
      {qualityGates.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2">
          {qualityGates.map((qualityGate) => (
            <div
              key={`${qualityGate.name}:${qualityGate.statusLabel}`}
              className="rounded border border-border bg-background px-3 py-2 text-xs"
            >
              <div className="font-medium text-foreground">{qualityGate.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                <ToneBadge
                  label={qualityGate.statusLabel}
                  className={resolveCoverageStatusBadgeClass(qualityGate.statusClass)}
                />
                {qualityGate.valueLabel ? <span>Value {qualityGate.valueLabel}</span> : null}
                {qualityGate.thresholdLabel ? (
                  <span>Threshold {qualityGate.thresholdLabel}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {modifiedFiles.length > 0 ? (
        <div className="rounded border border-border bg-background">
          <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Modified files
          </div>
          <div className="divide-y divide-border">
            {modifiedFiles.map((file) => (
              <div
                key={file.path}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2"
              >
                <div className="min-w-0 break-all text-sm text-foreground">{file.path}</div>
                <div className="flex shrink-0 gap-3">
                  <CoverageLineCount label="Covered" value={file.coveredCount} tone="success" />
                  <CoverageLineCount label="Missed" value={file.missedCount} tone="failure" />
                  <CoverageLineCount label="Partial" value={file.partialCount} tone="warning" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
          Modified-line coverage is unavailable for this build. Summary coverage is still shown.
        </div>
      )}
    </>
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
      <span
        className={`font-medium ${resolveMetricToneClass(coverageStatusClassToVisualTone(tone))}`}
      >
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </div>
  );
});
