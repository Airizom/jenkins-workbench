import { formatDurationMs } from "../../../formatters/DurationFormatters";
import { historyMetrics } from "../../../history/HistoryAnalysis";
import { SectionHeading } from "../../shared/webview/components/SectionHeading";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../shared/webview/components/ui/table";
import { cn } from "../../shared/webview/lib/utils";
import type { HistoryViewModel } from "../shared/HistoryContracts";
import { BuildResultLabel, type HistorySend, SelectedBuildBadge } from "./HistoryOutcomes";
import { compareBuildsLabel } from "./historyPresentation";

const COMPLETED_RESULTS = ["SUCCESS", "UNSTABLE", "FAILURE"];
const LOADING_TITLE = "Wait for history to finish loading";
const SELECT_HELP_ID = "history-builds-select-help";

function metricsLine(model: HistoryViewModel): string {
  const metrics = historyMetrics(model.builds.map((item) => item.build));
  const parts = [
    metrics.denominator
      ? `Success rate ${Math.round((100 * metrics.successful) / metrics.denominator)}% · ${metrics.successful} of ${metrics.denominator} completed ${metrics.denominator === 1 ? "build" : "builds"} passed`
      : "Success rate unavailable",
    `Median duration ${metrics.medianDuration === undefined ? "unavailable" : formatDurationMs(metrics.medianDuration)}`,
    metrics.aborted ? `${metrics.aborted} aborted` : "",
    metrics.notBuilt ? `${metrics.notBuilt} not built` : "",
    metrics.unknown ? `${metrics.unknown} unknown` : ""
  ];
  return parts.filter(Boolean).join(" · ");
}

type HistoryBuildItem = HistoryViewModel["builds"][number];

function reportBadge(report: HistoryBuildItem["report"]) {
  if (report.status === "available")
    return report.truncated ? (
      <Badge variant="warning" size="sm" title={PARTIAL_REASON}>
        Partial
        <span className="sr-only">. {PARTIAL_REASON}</span>
      </Badge>
    ) : (
      <Badge variant="muted" size="sm">
        Available
      </Badge>
    );
  const reason = report.message ?? "No test report for this build";
  return (
    <Badge
      variant="outline"
      size="sm"
      className="border-dashed border-muted-foreground-border text-muted-foreground"
      title={reason}
    >
      {report.status === "error" ? "Error" : "Unavailable"}
      <span className="sr-only">. {reason}</span>
    </Badge>
  );
}

const PARTIAL_REASON = "Only part of this test report was sampled";

function DurationBar({
  build,
  maxDuration
}: {
  build: HistoryBuildItem["build"];
  maxDuration: number;
}) {
  if (!COMPLETED_RESULTS.includes(build.result ?? ""))
    return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted-strong"
      >
        <span
          className="block h-full rounded-full bg-progress"
          style={{ width: `${((build.duration ?? 0) / maxDuration) * 100}%` }}
        />
      </span>
      <span className="whitespace-nowrap tabular-nums">{formatDurationMs(build.duration)}</span>
    </span>
  );
}

function CompareButton({
  model,
  buildNumber,
  loading,
  send
}: {
  model: HistoryViewModel;
  buildNumber: number;
  loading: boolean;
  send: HistorySend;
}) {
  if (model.selectedBuild === undefined || model.selectedBuild === buildNumber) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      aria-label={compareBuildsLabel(buildNumber, model.selectedBuild)}
      aria-disabled={loading || undefined}
      title={loading ? LOADING_TITLE : undefined}
      onClick={() => {
        if (!loading) send("compare", buildNumber);
      }}
    >
      Compare with #{model.selectedBuild}
    </Button>
  );
}

function HistoryBuildRow({
  item: { build, report },
  model,
  loading,
  maxDuration,
  send,
  onSelect
}: {
  item: HistoryBuildItem;
  model: HistoryViewModel;
  loading: boolean;
  maxDuration: number;
  send: HistorySend;
  onSelect: (buildNumber: number) => void;
}) {
  const selected = model.selectedBuild === build.number;
  return (
    <TableRow className={cn(selected && "bg-accent-soft hover:bg-accent-soft")}>
      <TableCell className="whitespace-nowrap">
        <span className="flex items-center gap-2">
          <Button
            variant={selected ? "secondary" : "outline"}
            size="xs"
            className="tabular-nums aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-pressed={selected}
            aria-describedby={SELECT_HELP_ID}
            aria-disabled={loading || undefined}
            title={loading ? LOADING_TITLE : `Analyze failures in build #${build.number}`}
            onClick={() => {
              if (!loading) onSelect(build.number);
            }}
          >
            #{build.number}
          </Button>
          {selected ? <SelectedBuildBadge label="Selected" /> : null}
        </span>
      </TableCell>
      <TableCell data-label="Result">
        <BuildResultLabel result={build.result} building={build.building} />
      </TableCell>
      <TableCell data-label="Duration">
        <DurationBar build={build} maxDuration={maxDuration} />
      </TableCell>
      <TableCell data-label="Test report">{reportBadge(report)}</TableCell>
      <TableCell className="whitespace-nowrap text-right max-sm:whitespace-normal">
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Open build #${build.number} details`}
          onClick={() => send("openBuild", build.number)}
        >
          Build details
        </Button>
        <CompareButton model={model} buildNumber={build.number} loading={loading} send={send} />
      </TableCell>
    </TableRow>
  );
}

/** Standalone build list, newest first; selecting a build re-anchors failure evidence. */
export function HistoryBuildsTable({
  model,
  send,
  onSelect
}: {
  model: HistoryViewModel;
  send: HistorySend;
  onSelect: (buildNumber: number) => void;
}) {
  const loading = model.status === "loading";
  const maxDuration = Math.max(1, ...model.builds.map((item) => item.build.duration ?? 0));
  return (
    <section aria-labelledby="history-builds-heading">
      <SectionHeading
        title={<span id="history-builds-heading">Builds · newest first</span>}
        count={model.builds.length}
      />
      <p className="mb-1 text-xs text-muted-foreground">{metricsLine(model)}</p>
      <p id={SELECT_HELP_ID} className="mb-2 text-xs text-muted-foreground">
        Select a build number to analyze its test failures; other rows then compare against it.
      </p>
      <div className="history-stack-table relative overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[36rem] text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Build</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Test report</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {model.builds.map((item) => (
              <HistoryBuildRow
                key={item.build.number}
                item={item}
                model={model}
                loading={loading}
                maxDuration={maxDuration}
                send={send}
                onSelect={onSelect}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
