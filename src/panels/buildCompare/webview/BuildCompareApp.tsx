import * as React from "react";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "../../shared/webview/components/ui/card";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import type {
  BuildCompareBuildViewModel,
  BuildCompareChangesetItem,
  BuildCompareConsoleSectionViewModel,
  BuildCompareParameterDiffItem,
  BuildCompareStageDiffItem,
  BuildCompareTestDiffItem,
  BuildCompareViewModel
} from "../shared/BuildCompareContracts";
import { useBuildCompareMessages } from "./hooks/useBuildCompareMessages";
import { buildCompareReducer } from "./state/buildCompareState";

const { useReducer } = React;

export function BuildCompareApp({ initialState }: { initialState: BuildCompareViewModel }) {
  const [state, dispatch] = useReducer(buildCompareReducer, initialState);
  useBuildCompareMessages(dispatch);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-header/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Build Compare
            </p>
            <h1 className="truncate text-lg font-semibold">{state.target.displayName}</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => postVsCodeMessage({ type: "swapBuilds" })}
          >
            Swap Baseline/Target
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
        {state.errors.length > 0 ? (
          <Card className="border-destructive-border">
            <CardHeader>
              <CardTitle>Comparison errors</CardTitle>
              <CardDescription>{state.errors.join(" ")}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          <BuildCard build={state.baseline} side="baseline" />
          <div className="hidden items-center justify-center lg:flex">
            <div className="rounded-full border border-border bg-muted-soft px-3 py-1 text-xs font-medium text-muted-foreground">
              baseline -&gt; target
            </div>
          </div>
          <BuildCard build={state.target} side="target" />
        </section>

        <SectionCard
          title="Test Diff"
          summary={state.tests.summaryLabel}
          detail={state.tests.detail}
          status={state.tests.status}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <SummaryStat label="Baseline" value={state.tests.baselineSummaryLabel} />
            <SummaryStat label="Target" value={state.tests.targetSummaryLabel} />
          </div>
          <DiffList
            title="New Failures"
            items={state.tests.newFailures}
            emptyLabel="No new failures."
          />
          <DiffList
            title="Still Failing"
            items={state.tests.stillFailing}
            emptyLabel="No still-failing tests."
          />
          <DiffList
            title="Newly Passing"
            items={state.tests.newPasses}
            emptyLabel="No newly passing tests."
          />
          <DiffList
            title="Added Tests"
            items={state.tests.addedTests}
            emptyLabel="No added tests."
          />
          <DiffList
            title="Removed Tests"
            items={state.tests.removedTests}
            emptyLabel="No removed tests."
          />
          <div className="grid gap-3 lg:grid-cols-2">
            <SummaryStat label="Other test changes" value={String(state.tests.otherChangesCount)} />
            <SummaryStat label="Unchanged tests" value={String(state.tests.unchangedCount)} />
          </div>
        </SectionCard>

        <SectionCard
          title="Parameter Diff"
          summary={state.parameters.summaryLabel}
          detail={state.parameters.detail}
          status={state.parameters.status}
        >
          {state.parameters.items.length > 0 ? (
            <div className="space-y-2">
              {state.parameters.items.map((item) => (
                <ParameterDiffRow key={`${item.changeType}:${item.name}`} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState label="No changed parameters." />
          )}
        </SectionCard>

        <SectionCard
          title="Changesets"
          summary={state.changesets.summaryLabel}
          detail={state.changesets.detail}
          status={state.changesets.status}
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <ChangesetColumn
              title="Baseline build changes"
              items={state.changesets.baselineItems}
            />
            <ChangesetColumn title="Target build changes" items={state.changesets.targetItems} />
          </div>
        </SectionCard>

        <SectionCard
          title="Stage Timing"
          summary={state.stages.summaryLabel}
          detail={state.stages.detail}
          status={state.stages.status}
        >
          {state.stages.items.length > 0 ? (
            <div className="space-y-2">
              {state.stages.items.map((item) => (
                <StageDiffRow key={`${item.changeType}:${item.name}`} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState label="No pipeline stage data to compare." />
          )}
        </SectionCard>

        <SectionCard
          title="Console Divergence"
          summary={state.console.summaryLabel}
          detail={state.console.detail}
          status={state.console.status}
        >
          {state.console.divergenceLineLabel ? (
            <Badge variant="outline" className="mb-3">
              {state.console.divergenceLineLabel}
            </Badge>
          ) : null}
          {state.console.status === "available" ? (
            <ConsoleComparison section={state.console} />
          ) : (
            <EmptyState
              label={
                state.console.status === "loading"
                  ? "Console comparison is still loading."
                  : state.console.status === "tooLarge"
                    ? "Open the underlying build details to inspect the full logs."
                    : state.console.status === "identical"
                      ? "Both console logs matched within the configured comparison limits."
                      : "Console comparison did not produce a snippet."
              }
            />
          )}
        </SectionCard>
      </main>
    </div>
  );
}

function BuildCard({
  build,
  side
}: {
  build: BuildCompareBuildViewModel;
  side: "baseline" | "target";
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {build.roleLabel}
            </p>
            <CardTitle className="truncate">{build.displayName}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <ResultBadge resultClass={build.resultClass} label={build.resultLabel} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => postVsCodeMessage({ type: "openBuildDetails", side })}
            >
              Open Build Details
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SummaryStat label="Duration" value={build.durationLabel} />
          <SummaryStat label="Completed" value={build.timestampLabel} />
          <SummaryStat label="Result" value={build.resultLabel} />
        </div>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  summary,
  detail,
  status,
  children
}: React.PropsWithChildren<{
  title: string;
  summary: string;
  detail?: string;
  status: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{summary}</CardDescription>
            {detail ? <p className="mt-2 text-xs text-muted-foreground">{detail}</p> : null}
          </div>
          <Badge variant="outline" className="capitalize">
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-mutedBorder bg-muted-soft px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function DiffList({
  title,
  items,
  emptyLabel
}: {
  title: string;
  items: BuildCompareTestDiffItem[];
  emptyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <TestDiffRow key={item.key} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState label={emptyLabel} />
      )}
    </div>
  );
}

function TestDiffRow({ item }: { item: BuildCompareTestDiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[item.className, item.suiteName].filter(Boolean).join(" • ") || "Unnamed suite"}
          </p>
        </div>
        <div className="grid gap-2 text-right text-xs sm:grid-cols-2 sm:gap-4">
          <div>
            <p className="text-muted-foreground">Baseline</p>
            <p>{item.baselineStatusLabel}</p>
            {item.baselineDurationLabel ? (
              <p className="text-muted-foreground">{item.baselineDurationLabel}</p>
            ) : null}
          </div>
          <div>
            <p className="text-muted-foreground">Target</p>
            <p>{item.targetStatusLabel}</p>
            {item.targetDurationLabel ? (
              <p className="text-muted-foreground">{item.targetDurationLabel}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ParameterDiffRow({ item }: { item: BuildCompareParameterDiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.name}</p>
          <p className="mt-1 text-xs text-muted-foreground capitalize">{item.changeType}</p>
        </div>
        <div className="grid min-w-0 gap-2 text-xs sm:grid-cols-2 sm:gap-4">
          <ValueCell label="Baseline" value={item.baselineValue} />
          <ValueCell label="Target" value={item.targetValue} />
        </div>
      </div>
    </div>
  );
}

function ValueCell({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded border border-mutedBorder bg-background px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-[12px]">{value ?? "-"}</p>
    </div>
  );
}

function ChangesetColumn({ title, items }: { title: string; items: BuildCompareChangesetItem[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div
              key={`${item.commitId ?? item.message}:${index}`}
              className="rounded-lg border border-border bg-muted-soft px-3 py-2"
            >
              <p className="text-sm">{item.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.author}
                {item.commitId ? ` • ${item.commitId}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState label="No changesets recorded." />
      )}
    </div>
  );
}

function StageDiffRow({ item }: { item: BuildCompareStageDiffItem }) {
  return (
    <div className="rounded-lg border border-border bg-muted-soft px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="mt-1 text-xs capitalize text-muted-foreground">{item.changeType}</p>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-3 sm:gap-4">
          <StageValueCell
            label="Baseline"
            status={item.baselineStatusLabel}
            statusClass={item.baselineStatusClass}
            duration={item.baselineDurationLabel}
          />
          <StageValueCell
            label="Target"
            status={item.targetStatusLabel}
            statusClass={item.targetStatusClass}
            duration={item.targetDurationLabel}
          />
          <ValueCell label="Delta" value={item.deltaLabel ?? "-"} />
        </div>
      </div>
    </div>
  );
}

function StageValueCell({
  label,
  status,
  statusClass,
  duration
}: {
  label: string;
  status?: string;
  statusClass?: string;
  duration?: string;
}) {
  return (
    <div className="min-w-0 rounded border border-mutedBorder bg-background px-2 py-1">
      <p className="text-muted-foreground">{label}</p>
      <p className={`text-sm ${resolveResultTextClass(statusClass)}`}>{status ?? "-"}</p>
      <p className="text-muted-foreground">{duration ?? "-"}</p>
    </div>
  );
}

function ConsoleComparison({ section }: { section: BuildCompareConsoleSectionViewModel }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ConsoleSnippet title="Baseline" lines={section.baselineLines} />
      <ConsoleSnippet title="Target" lines={section.targetLines} />
    </div>
  );
}

function ConsoleSnippet({
  title,
  lines
}: {
  title: string;
  lines: BuildCompareConsoleSectionViewModel["baselineLines"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-terminal">
      <div className="border-b border-border px-3 py-2 text-sm font-medium text-terminal-foreground">
        {title}
      </div>
      <div className="max-h-[28rem] overflow-auto">
        {lines.map((line) => (
          <div
            key={`${title}:${line.lineNumber}`}
            className={`console-line grid grid-cols-[5rem_1fr] gap-3 px-3 py-1.5 font-mono text-[12px] leading-5 ${
              line.highlight ? "bg-warning-surface" : ""
            }`}
          >
            <span className="select-none text-right text-muted-foreground">{line.lineNumber}</span>
            <span className="whitespace-pre-wrap break-words text-terminal-foreground">
              {line.text.length > 0 ? line.text : " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultBadge({ resultClass, label }: { resultClass: string; label: string }) {
  return <Badge className={resolveResultBadgeClass(resultClass)}>{label}</Badge>;
}

function resolveResultBadgeClass(resultClass: string): string {
  switch (resultClass) {
    case "success":
      return "border-success-border bg-success-soft text-success-foreground";
    case "failure":
      return "border-failure-border bg-failure-soft text-failure-foreground";
    case "unstable":
      return "border-warning-border bg-warning-soft text-warning-foreground";
    case "aborted":
      return "border-aborted-border bg-aborted-soft text-aborted-foreground";
    case "running":
      return "border-inputInfoBorder bg-inputInfoBg text-inputInfoFg";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function resolveResultTextClass(resultClass?: string): string {
  switch (resultClass) {
    case "success":
      return "text-success-foreground";
    case "failure":
      return "text-failure-foreground";
    case "unstable":
      return "text-warning-foreground";
    case "aborted":
      return "text-aborted-foreground";
    case "running":
      return "text-inputInfoFg";
    default:
      return "text-foreground";
  }
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-mutedBorder px-3 py-4 text-sm text-muted-foreground">
      {label}
    </div>
  );
}
