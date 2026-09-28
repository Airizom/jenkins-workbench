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
  type HistoryUiState,
  type HistoryViewModel,
  normalizeHistoryUi
} from "../shared/HistoryContracts";
import { type HistorySend, OutcomeBadge, TestOutcomeTimeline } from "./HistoryOutcomes";
import {
  filterTests,
  HISTORY_FILTER_LABELS,
  HISTORY_PAGE_SIZE,
  observationGaps,
  selectedBuildIndex,
  testIdentityLabel
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

function FailureRate({ test }: { test: TestHistory }) {
  const usable = test.failed + test.passed;
  const gaps = observationGaps(test);
  return (
    <div className="space-y-1">
      <div className="tabular-nums">
        {usable ? `${Math.round((100 * test.failed) / usable)}%` : "—"}
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
              </Badge>
            ) : (
              <span
                key={gap.label}
                className="text-[11px] text-muted-foreground"
                title={gap.tooltip}
              >
                {gap.label}
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
      title={testIdentityLabel(test)}
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
        <span className="block truncate font-medium text-foreground group-hover:underline">
          {test.name}
        </span>
        {context ? (
          <span className="block truncate text-[11px] text-muted-foreground">{context}</span>
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
        <div
          title={
            evidence.source === "jenkins" ? "From Jenkins test age" : "From the sampled builds"
          }
        >
          {evidence.label}
        </div>
      ) : null}
      {outcome === "failed" ? (
        <div className="text-[11px] text-muted-foreground">
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
  send
}: {
  model: HistoryViewModel;
  test: TestHistory;
  detailsId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  send: HistorySend;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={4} className="bg-muted-soft px-3 pb-3 pt-2">
        <section id={detailsId} aria-labelledby={`${detailsId}-heading`}>
          <h3
            id={`${detailsId}-heading`}
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring mb-1 truncate rounded-sm text-sm font-semibold"
            title={testIdentityLabel(test)}
          >
            {test.name}
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Outcomes by build, newest first. Ambiguous or unavailable results break transition
            sequences and never count as passes.
          </p>
          <TestOutcomeTimeline
            model={model}
            test={test}
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
  onToggle,
  send
}: {
  model: HistoryViewModel;
  test: TestHistory;
  index: number;
  expanded: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
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
        <TableCell className="align-top">
          <FailureRate test={test} />
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums">{test.transitions}</span>
            {test.intermittent ? (
              <Badge variant="warning" size="sm">
                Intermittent
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <SelectedBuildOutcome model={model} test={test} index={index} />
        </TableCell>
      </TableRow>
      {expanded ? (
        <TestDetailsRow
          model={model}
          test={test}
          detailsId={detailsId}
          headingRef={headingRef}
          send={send}
        />
      ) : null}
    </>
  );
}

export function HistoryTestsSection({
  model,
  ui,
  setUi,
  send
}: {
  model: HistoryViewModel;
  ui: HistoryUiState;
  setUi: (ui: HistoryUiState) => void;
  send: HistorySend;
}) {
  const [page, setPage] = React.useState(0);
  const focusDetails = React.useRef(false);
  const detailsHeading = React.useRef<HTMLHeadingElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: These changes reset pagination even though their values are not read by the effect.
  React.useEffect(() => {
    setPage(0);
  }, [ui.search, ui.filter, model.jobUrl]);
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
      </div>
      {tests.length ? (
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <Table className="min-w-[48rem] table-fixed text-xs">
            <colgroup>
              <col />
              <col className="w-36" />
              <col className="w-24" />
              <col className="w-48" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Test</TableHead>
                <TableHead>Failure rate</TableHead>
                <TableHead>Transitions</TableHead>
                <TableHead>
                  {model.selectedBuild === undefined
                    ? "Selected build"
                    : `Build #${model.selectedBuild}`}
                </TableHead>
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
