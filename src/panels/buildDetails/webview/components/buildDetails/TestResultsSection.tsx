import * as React from "react";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "../../../../shared/webview/components/ui/collapsible";
import { Input } from "../../../../shared/webview/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem
} from "../../../../shared/webview/components/ui/toggle-group";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  FileIcon,
  SearchIcon,
  TestTubeIcon,
  XCircleIcon
} from "../../../../shared/webview/icons";
import { cn } from "../../../../shared/webview/lib/utils";
import type {
  BuildDetailsCoverageStateViewModel,
  BuildTestCaseViewModel,
  BuildTestResultsViewModel,
  BuildTestsSummaryViewModel,
  TestResultStatus
} from "../../../shared/BuildDetailsContracts";

const { useEffect, useMemo, useState } = React;

const RENDER_BATCH_SIZE = 500;
const AUTO_EXPAND_FAILED_LIMIT = 3;

type TestStatusFilter = "all" | "failed" | "skipped" | "passed";

export function TestResultsSection({
  buildUrl,
  summary,
  results,
  coverageState,
  onReloadWithLogs,
  onOpenSource
}: {
  buildUrl?: string;
  summary: BuildTestsSummaryViewModel;
  results: BuildTestResultsViewModel;
  coverageState: BuildDetailsCoverageStateViewModel;
  onReloadWithLogs: () => void;
  onOpenSource: (testCase: BuildTestCaseViewModel) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<TestStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [renderCount, setRenderCount] = useState(RENDER_BATCH_SIZE);
  const datasetKey = useMemo(
    () => [buildUrl ?? "", ...results.items.map((item) => item.id)].join("::"),
    [buildUrl, results.items]
  );

  const filteredItems = useMemo(
    () =>
      results.items.filter((item) => {
        if (statusFilter !== "all" && item.status !== statusFilter) {
          return false;
        }
        if (!query.trim()) {
          return true;
        }
        const haystack = [item.name, item.className, item.suiteName, item.statusLabel]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.trim().toLowerCase());
      }),
    [query, results.items, statusFilter]
  );

  const autoExpandIds = useMemo(() => {
    const ids = new Set<string>();
    let count = 0;
    for (const item of results.items) {
      if (item.status === "failed" && hasTestDetails(item) && count < AUTO_EXPAND_FAILED_LIMIT) {
        ids.add(item.id);
        count++;
      }
    }
    return ids;
  }, [results.items]);

  useEffect(() => {
    setRenderCount(RENDER_BATCH_SIZE);
  }, [query, statusFilter]);

  useEffect(() => {
    setStatusFilter("all");
    setQuery("");
    setRenderCount(RENDER_BATCH_SIZE);
  }, [datasetKey]);

  const visibleItems = filteredItems.slice(0, renderCount);
  const hasMore = filteredItems.length > visibleItems.length;
  const passRate =
    summary.totalCount > 0 ? Math.round((summary.passedCount / summary.totalCount) * 100) : 0;

  return (
    <section className="space-y-3">
      <CoverageSection coverageState={coverageState} />

      <div className="rounded border border-border bg-muted-soft p-3 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-background">
              <TestTubeIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Test Results</span>
                {summary.hasAnyResults ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      summary.failedCount > 0
                        ? "border-failure-border-subtle text-failure"
                        : "border-success-border text-success"
                    )}
                  >
                    {passRate}% passed
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">{summary.summaryLabel}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryMetric label="Failed" value={summary.failedCount} tone="failed" />
            <SummaryMetric label="Skipped" value={summary.skippedCount} tone="skipped" />
            <SummaryMetric label="Passed" value={summary.passedCount} tone="passed" />
            <SummaryMetric label="Total" value={summary.totalCount} tone="neutral" />
          </div>
        </div>
        {summary.hasAnyResults ? <TestDistributionBar summary={summary} /> : null}
      </div>

      <div className="sticky-header rounded border border-border bg-background/95 p-3 backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <ToggleGroup
              type="single"
              value={statusFilter}
              onValueChange={(value) => {
                if (value) {
                  setStatusFilter(value as TestStatusFilter);
                }
              }}
              className="w-full sm:w-auto"
            >
              <ToggleGroupItem value="all">
                All ({summary.totalCount.toLocaleString()})
              </ToggleGroupItem>
              <ToggleGroupItem
                value="failed"
                className={
                  summary.failedCount > 0
                    ? "text-failure data-[state=on]:text-list-activeForeground"
                    : ""
                }
              >
                Failed ({summary.failedCount.toLocaleString()})
              </ToggleGroupItem>
              <ToggleGroupItem value="skipped">
                Skipped ({summary.skippedCount.toLocaleString()})
              </ToggleGroupItem>
              <ToggleGroupItem value="passed">
                Passed ({summary.passedCount.toLocaleString()})
              </ToggleGroupItem>
            </ToggleGroup>
            <div className="relative block min-w-[260px] flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search test results"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search suite, class, or test name"
                className="pl-8"
              />
            </div>
          </div>
          {summary.canLoadLogs ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onReloadWithLogs}
              disabled={results.loading}
            >
              {results.loading ? "Loading Logs..." : "Load Logs"}
            </Button>
          ) : null}
        </div>
      </div>

      {results.loading ? (
        <EmptyState
          icon="loading"
          title="Loading detailed test results"
          message="Fetching Jenkins case-level data for this build."
        />
      ) : summary.detailsUnavailable ? (
        <EmptyState
          icon="info"
          title="Detailed results unavailable"
          message="Jenkins reported test counts for this build, but case-level results are unavailable."
        />
      ) : !summary.hasAnyResults ? (
        <EmptyState
          icon="empty"
          title="No test results"
          message="This build did not report any tests."
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matching tests"
          message="Adjust the status filter or search query to see more results."
        />
      ) : (
        <div className="rounded border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span>
              Showing {visibleItems.length.toLocaleString()} of{" "}
              {filteredItems.length.toLocaleString()} tests
            </span>
            <div className="flex items-center gap-2">
              {summary.logsIncluded ? (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Case logs loaded
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="divide-y divide-border">
            {visibleItems.map((item) => (
              <TestResultRow
                key={item.id}
                item={item}
                initialOpen={autoExpandIds.has(item.id)}
                onOpenSource={onOpenSource}
              />
            ))}
          </div>
          {hasMore ? (
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {(filteredItems.length - visibleItems.length).toLocaleString()} more tests
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRenderCount((current) => current + RENDER_BATCH_SIZE)}
              >
                Show More
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CoverageSection({
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
  tone: "success" | "warning" | "failure" | "neutral";
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
  tone: "success" | "warning" | "failure";
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

function TestDistributionBar({ summary }: { summary: BuildTestsSummaryViewModel }) {
  const total = Math.max(summary.totalCount, 1);
  const failedPct = (summary.failedCount / total) * 100;
  const skippedPct = (summary.skippedCount / total) * 100;
  const passedPct = (summary.passedCount / total) * 100;

  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-label={`${Math.round(passedPct)}% tests passed`}
      aria-valuenow={Math.round(passedPct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {failedPct > 0 ? (
        <div
          className="bg-failure transition-all duration-300"
          style={{ width: `${failedPct}%` }}
        />
      ) : null}
      {skippedPct > 0 ? (
        <div
          className="bg-warning transition-all duration-300"
          style={{ width: `${skippedPct}%` }}
        />
      ) : null}
      {passedPct > 0 ? (
        <div
          className="bg-success transition-all duration-300"
          style={{ width: `${passedPct}%` }}
        />
      ) : null}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "failed" | "skipped" | "passed" | "neutral";
}) {
  return (
    <div className={cn("rounded border px-3 py-2", metricCardClassName(tone))}>
      <div className="flex items-center gap-1.5">
        {tone !== "neutral" ? (
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", metricDotClassName(tone))} />
        ) : null}
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className={cn("text-lg font-semibold tabular-nums", metricToneClassName(tone))}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function TestResultRow({
  item,
  initialOpen,
  onOpenSource
}: {
  item: BuildTestCaseViewModel;
  initialOpen?: boolean;
  onOpenSource: (testCase: BuildTestCaseViewModel) => void;
}) {
  const [open, setOpen] = useState(initialOpen ?? false);
  const hasDetails = hasTestDetails(item);
  const borderClass = statusBorderClass(item.status);

  const content = (
    <>
      <StatusGlyph status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[item.className, item.suiteName].filter(Boolean).join(" \u2022 ") || "Unnamed suite"}
        </div>
      </div>
      <StatusBadge status={item.status} label={item.statusLabel} />
      {item.durationLabel ? (
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          <ClockIcon className="h-3.5 w-3.5" />
          {item.durationLabel}
        </span>
      ) : null}
      {hasDetails ? (
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : ""
          )}
        />
      ) : null}
    </>
  );

  if (!hasDetails) {
    return (
      <div className={cn("flex items-center gap-3 px-3 py-2", borderClass)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
        {item.canOpenSource ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenSource(item)}>
            <FileIcon className="h-3.5 w-3.5" />
            Source
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("group", borderClass)}>
      <div className="flex items-center gap-3 px-3 py-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-foreground"
          >
            {content}
          </button>
        </CollapsibleTrigger>
        {item.canOpenSource ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenSource(item)}>
            <FileIcon className="h-3.5 w-3.5" />
            Source
          </Button>
        ) : null}
      </div>
      <CollapsibleContent className="border-t border-border bg-muted-soft px-3 py-3">
        <div className="space-y-2">
          {item.errorDetails ? (
            <DetailBlock label="Failure" value={item.errorDetails} tone="failure" />
          ) : null}
          {item.errorStackTrace ? (
            <DetailBlock label="Stack Trace" value={item.errorStackTrace} tone="failure" />
          ) : null}
          {item.stdout ? <DetailBlock label="Stdout" value={item.stdout} /> : null}
          {item.stderr ? <DetailBlock label="Stderr" value={item.stderr} tone="warning" /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DetailBlock({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "failure" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded border border-border bg-background",
        tone === "failure" && "border-l-2 border-l-failure",
        tone === "warning" && "border-l-2 border-l-warning"
      )}
    >
      <div className="border-b border-border px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="m-0 max-h-52 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word">
        {value}
      </pre>
    </div>
  );
}

type EmptyStateIcon = "loading" | "info" | "empty" | "search";

function EmptyState({
  icon,
  title,
  message
}: {
  icon?: EmptyStateIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="rounded border border-dashed border-border bg-muted-soft px-4 py-8 text-center">
      {icon ? (
        <div className="mx-auto mb-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-muted">
          <EmptyStateGlyph icon={icon} />
        </div>
      ) : null}
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{message}</div>
    </div>
  );
}

function EmptyStateGlyph({ icon }: { icon: EmptyStateIcon }) {
  switch (icon) {
    case "loading":
      return <TestTubeIcon className="h-4 w-4 animate-pulse text-muted-foreground" />;
    case "info":
      return <AlertCircleIcon className="h-4 w-4 text-warning" />;
    case "empty":
      return <TestTubeIcon className="h-4 w-4 text-muted-foreground" />;
    case "search":
      return <SearchIcon className="h-4 w-4 text-muted-foreground" />;
  }
}

const STATUS_ICON_STYLE = { width: 14, height: 14 };

function StatusGlyph({ status }: { status: BuildTestCaseViewModel["status"] }) {
  switch (status) {
    case "passed":
      return <CheckCircleIcon className="shrink-0 text-success" style={STATUS_ICON_STYLE} />;
    case "skipped":
      return <AlertCircleIcon className="shrink-0 text-warning" style={STATUS_ICON_STYLE} />;
    case "failed":
      return <XCircleIcon className="shrink-0 text-failure" style={STATUS_ICON_STYLE} />;
    default:
      return <TestTubeIcon className="shrink-0 text-muted-foreground" style={STATUS_ICON_STYLE} />;
  }
}

function StatusBadge({ status, label }: { status: TestResultStatus; label: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0",
        status === "failed" && "border-failure-border-subtle text-failure",
        status === "passed" && "border-success-border text-success",
        status === "skipped" && "border-warning-border text-warning",
        status === "other" && "border-border text-muted-foreground"
      )}
    >
      {label}
    </Badge>
  );
}

function hasTestDetails(item: BuildTestCaseViewModel): boolean {
  return Boolean(item.errorDetails || item.errorStackTrace || item.stdout || item.stderr);
}

function statusBorderClass(status: TestResultStatus): string {
  switch (status) {
    case "failed":
      return "border-l-2 border-l-failure";
    case "skipped":
      return "border-l-2 border-l-warning";
    default:
      return "";
  }
}

function metricCardClassName(tone: "failed" | "skipped" | "passed" | "neutral"): string {
  switch (tone) {
    case "failed":
      return "border-failure-border-subtle bg-failure-surface";
    case "skipped":
      return "border-border bg-warning-surface";
    case "passed":
      return "border-success-border bg-success-soft";
    default:
      return "border-border bg-background";
  }
}

function metricDotClassName(tone: "failed" | "skipped" | "passed"): string {
  switch (tone) {
    case "failed":
      return "bg-failure";
    case "skipped":
      return "bg-warning";
    case "passed":
      return "bg-success";
  }
}

function metricToneClassName(tone: "failed" | "skipped" | "passed" | "neutral"): string {
  switch (tone) {
    case "failed":
      return "text-failure";
    case "skipped":
      return "text-warning";
    case "passed":
      return "text-success";
    default:
      return "text-foreground";
  }
}

function mapToneToMetricTone(
  tone: "success" | "warning" | "failure" | "neutral"
): "passed" | "skipped" | "failed" | "neutral" {
  switch (tone) {
    case "success":
      return "passed";
    case "warning":
      return "skipped";
    case "failure":
      return "failed";
    default:
      return "neutral";
  }
}

function coverageToneClassName(tone: "success" | "warning" | "failure" | "neutral"): string {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "failure":
      return "text-failure";
    default:
      return "text-foreground";
  }
}

function coverageStatusBadgeClassName(statusClass?: string): string {
  switch (statusClass) {
    case "success":
      return "border-success-border text-success";
    case "warning":
      return "border-border text-warning";
    case "failure":
      return "border-failure-border-subtle text-failure";
    default:
      return "border-border text-muted-foreground";
  }
}

function toCoverageTone(statusClass?: string): "success" | "warning" | "failure" | "neutral" {
  switch (statusClass) {
    case "success":
    case "warning":
    case "failure":
      return statusClass;
    default:
      return "neutral";
  }
}
