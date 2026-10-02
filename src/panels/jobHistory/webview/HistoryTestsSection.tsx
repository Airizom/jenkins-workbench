import * as React from "react";
import type { TestHistory } from "../../../history/HistoryAnalysis";
import { SectionHeading } from "../../shared/webview/components/SectionHeading";
import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { Input } from "../../shared/webview/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../shared/webview/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../shared/webview/components/ui/table";
import { ChevronDownIcon } from "../../shared/webview/icons";
import { cn } from "../../shared/webview/lib/utils";
import {
  type HistorySort,
  type HistoryUiState,
  type HistoryViewModel,
  normalizeHistoryUi
} from "../shared/HistoryContracts";
import { type HistorySend, OutcomeBadge, TestOutcomeTimeline } from "./HistoryOutcomes";
import {
  failureRate,
  filterTests,
  HISTORY_FILTER_LABELS,
  HISTORY_PAGE_SIZE,
  HISTORY_SORT_LABELS,
  observationGaps,
  selectedBuildIndex,
  unavailableReportBuilds
} from "./historyPresentation";

const BASELINE_LABELS: Record<string, string> = {
  failed: "Also failing",
  passed: "Passing",
  skipped: "Skipped",
  ambiguous: "Ambiguous",
  unknown: "Unknown",
  missing: "Not reported",
  unavailable: "Unavailable",
  error: "Unavailable"
};

function baselineLabel(model: HistoryViewModel, test: TestHistory): string {
  const baseline = model.baseline;
  if (!baseline) return "Resolving…";
  if (baseline.status !== "available") return "Unavailable";
  return BASELINE_LABELS[model.baselineOutcomes?.[test.key] ?? "missing"] ?? "Unavailable";
}

function FailureRate({ model, test }: { model: HistoryViewModel; test: TestHistory }) {
  const usable = test.failed + test.passed;
  const rate = failureRate(test);
  const gaps = observationGaps(test, model);
  return (
    <div className="space-y-1">
      <div className="tabular-nums">
        {rate === undefined ? "—" : `${Math.round(100 * rate)}%`}
        <span className="text-muted-foreground">
          {" "}
          · {test.failed}/{usable} failed
        </span>
      </div>
      {gaps.length ? (
        <div className="flex flex-wrap gap-1">
          {gaps.map((gap) =>
            gap.emphasis ? (
              <Badge
                key={gap.label}
                variant="outline"
                size="sm"
                className="border-dashed border-muted-foreground-border text-muted-foreground"
                title={gap.tooltip}
              >
                {gap.label}
                {gap.tooltip ? <span className="sr-only">. {gap.tooltip}</span> : null}
              </Badge>
            ) : (
              <span
                key={gap.label}
                className="text-caption text-muted-foreground"
                title={gap.tooltip}
              >
                {gap.label}
                {gap.tooltip ? <span className="sr-only">. {gap.tooltip}</span> : null}
              </span>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

function TestNameButton({
  test,
  expanded,
  detailsId,
  onToggle
}: {
  test: TestHistory;
  expanded: boolean;
  detailsId: string;
  onToggle: (key: string) => void;
}) {
  const context = [test.suiteName, test.className].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className="focus-ring group flex w-full min-w-0 items-start gap-1.5 rounded-sm text-left"
      aria-expanded={expanded}
      aria-controls={expanded ? detailsId : undefined}
      onClick={() => onToggle(test.key)}
    >
      <ChevronDownIcon
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
          !expanded && "-rotate-90"
        )}
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground [overflow-wrap:anywhere] group-hover:underline">
          {test.name}
        </span>
        {context ? (
          <span className="block text-caption text-muted-foreground [overflow-wrap:anywhere]">
            {context}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function SelectedBuildOutcome({
  model,
  test,
  index
}: {
  model: HistoryViewModel;
  test: TestHistory;
  index: number;
}) {
  const evidence = model.evidence[test.key];
  const outcome = test.outcomes[index];
  return (
    <div className="space-y-1">
      <OutcomeBadge outcome={outcome} />
      {evidence ? (
        <div>
          {evidence.label}
          <span className="sr-only">
            {evidence.source === "jenkins"
              ? " (from Jenkins test age)"
              : " (from the sampled builds)"}
          </span>
        </div>
      ) : null}
      {outcome === "failed" ? (
        <div className="text-caption text-muted-foreground">
          Baseline: {baselineLabel(model, test)}
        </div>
      ) : null}
    </div>
  );
}

function TestDetailsRow({
  model,
  test,
  detailsId,
  headingRef,
  selectedLabel,
  send
}: {
  model: HistoryViewModel;
  test: TestHistory;
  detailsId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  selectedLabel: string;
  send: HistorySend;
}) {
  const context = [test.suiteName, test.className].filter(Boolean).join(" · ");
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={4} className="bg-muted-soft px-3 pb-3 pt-2">
        <section id={detailsId} aria-labelledby={`${detailsId}-heading`}>
          <h3
            id={`${detailsId}-heading`}
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring mb-1 rounded-sm text-sm font-semibold [overflow-wrap:anywhere]"
          >
            {test.name}
          </h3>
          {context ? (
            <p className="mb-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{context}</p>
          ) : null}
          <p className="mb-2 text-xs text-muted-foreground">
            Outcomes by build, newest first. Ambiguous or unavailable results break transition
            sequences and never count as passes.
          </p>
          <TestOutcomeTimeline
            model={model}
            test={test}
            selectedLabel={selectedLabel}
            onOpenBuild={(buildNumber) => send("openBuild", buildNumber)}
            onCompare={(buildNumber) => send("compare", buildNumber)}
          />
        </section>
      </TableCell>
    </TableRow>
  );
}

function HistoryTestRow({
  model,
  test,
  index,
  expanded,
  headingRef,
  selectedLabel,
  outcomeLabel,
  onToggle,
  send
}: {
  model: HistoryViewModel;
  test: TestHistory;
  index: number;
  expanded: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  selectedLabel: string;
  outcomeLabel: string;
  onToggle: (key: string) => void;
  send: HistorySend;
}) {
  const detailsId = `history-test-${encodeURIComponent(test.key)}`;
  return (
    <>
      <TableRow className={cn("align-top", expanded && "bg-accent-soft")}>
        <TableCell className="align-top">
          <TestNameButton
            test={test}
            expanded={expanded}
            detailsId={detailsId}
            onToggle={onToggle}
          />
        </TableCell>
        <TableCell className="align-top" data-label="Failure rate">
          <FailureRate model={model} test={test} />
        </TableCell>
        <TableCell className="align-top" data-label="Transitions">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums">{test.transitions}</span>
            {test.intermittent ? (
              <Badge variant="warning" size="sm">
                Intermittent
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="align-top" data-label={outcomeLabel}>
          <SelectedBuildOutcome model={model} test={test} index={index} />
        </TableCell>
      </TableRow>
      {expanded ? (
        <TestDetailsRow
          model={model}
          test={test}
          detailsId={detailsId}
          headingRef={headingRef}
          selectedLabel={selectedLabel}
          send={send}
        />
      ) : null}
    </>
  );
}

/** aria-sort for a column header; only the active non-default sort is announced. */
function ariaSort(ui: HistoryUiState, column: HistorySort): "ascending" | "descending" | undefined {
  if (ui.sort !== column) return undefined;
  return column === "name" ? "ascending" : "descending";
}

function UnavailableReportsNote({ model }: { model: HistoryViewModel }) {
  const builds = unavailableReportBuilds(model);
  if (!builds.length) return null;
  const shown = builds.slice(0, 5).map((number) => `#${number}`);
  const list =
    builds.length > shown.length
      ? `${shown.join(", ")} and ${builds.length - shown.length} more`
      : shown.join(", ");
  return (
    <p className="text-xs text-muted-foreground">
      No test report for {builds.length === 1 ? "build" : "builds"} {list}. Those builds are left
      out of failure rates and transitions; they are not counted as passes.
    </p>
  );
}

export function HistoryTestsSection({
  model,
  ui,
  setUi,
  send,
  embedded = false
}: {
  model: HistoryViewModel;
  ui: HistoryUiState;
  setUi: (ui: HistoryUiState) => void;
  send: HistorySend;
  /** Inside Build Details the selected build is the panel's own build. */
  embedded?: boolean;
}) {
  const [page, setPage] = React.useState(0);
  const focusDetails = React.useRef(false);
  const detailsHeading = React.useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: These changes reset pagination even though their values are not read by the effect.
  React.useEffect(() => {
    setPage(0);
  }, [ui.search, ui.filter, ui.sort, model.jobUrl]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Focus follows the user's expansion, not re-renders.
  React.useEffect(() => {
    if (!focusDetails.current) return;
    focusDetails.current = false;
    detailsHeading.current?.focus();
  }, [ui.selectedTest]);
  const tests = filterTests(model, ui);
  const pageCount = Math.max(1, Math.ceil(tests.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const index = selectedBuildIndex(model);
  const visible = tests.slice(
    currentPage * HISTORY_PAGE_SIZE,
    (currentPage + 1) * HISTORY_PAGE_SIZE
  );
  const toggle = (key: string) => {
    const expanding = ui.selectedTest !== key;
    focusDetails.current = expanding;
    setUi({ ...ui, selectedTest: expanding ? key : undefined });
  };
  const outcomeLabel =
    model.selectedBuild === undefined ? "Selected build" : `Build #${model.selectedBuild}`;
  const selectedLabel = embedded ? "This build" : "Selected";
  return (
    <section aria-labelledby="history-tests-heading" className="space-y-2">
      <SectionHeading
        className="mb-0"
        title={<span id="history-tests-heading">Tests</span>}
        count={
          tests.length === model.tests.length
            ? tests.length
            : `${tests.length} of ${model.tests.length}`
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search test history"
          placeholder="Search tests"
          className="w-64 max-w-full"
          value={ui.search}
          onChange={(event) => setUi({ ...ui, search: event.target.value })}
        />
        <Select
          value={ui.filter}
          onValueChange={(filter) => setUi(normalizeHistoryUi({ ...ui, filter }))}
        >
          <SelectTrigger aria-label="Filter test history" className="w-52 max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(HISTORY_FILTER_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={ui.sort}
          onValueChange={(sort) => setUi(normalizeHistoryUi({ ...ui, sort }))}
        >
          <SelectTrigger aria-label="Sort test history" className="w-60 max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(HISTORY_SORT_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <UnavailableReportsNote model={model} />
      {tests.length ? (
        <div className="history-stack-table relative overflow-x-auto rounded-lg border border-border">
          <Table className="min-w-[48rem] table-fixed text-xs">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-24" />
              <col className="w-48" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead aria-sort={ariaSort(ui, "name")}>Test</TableHead>
                <TableHead aria-sort={ariaSort(ui, "failureRate")}>Failure rate</TableHead>
                <TableHead aria-sort={ariaSort(ui, "transitions")}>Transitions</TableHead>
                <TableHead>{outcomeLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((test) => (
                <HistoryTestRow
                  key={test.key}
                  model={model}
                  test={test}
                  index={index}
                  expanded={ui.selectedTest === test.key}
                  headingRef={detailsHeading}
                  selectedLabel={selectedLabel}
                  outcomeLabel={outcomeLabel}
                  onToggle={toggle}
                  send={send}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {model.tests.length
            ? "No tests match the search or filter."
            : "No test observations in these builds."}
        </p>
      )}
      {pageCount > 1 ? (
        <nav aria-label="Test pages" className="flex items-center justify-end gap-2 text-xs">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          <span className="tabular-nums text-muted-foreground">
            Page {currentPage + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
