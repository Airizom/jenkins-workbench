import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { RefreshIcon } from "../../shared/webview/icons";
import { type HistoryViewModel, historyJobDisplayName } from "../shared/HistoryContracts";
import type { HistorySend } from "./HistoryOutcomes";
import { formatHistoryTimestamp } from "./historyPresentation";

const AUTOMATIC_BASELINE = "Automatic default: the multibranch main or master branch";

function baselineJobName(
  baseline: NonNullable<HistoryViewModel["baseline"]>,
  environmentUrl?: string
): string {
  if (baseline.status === "self") return "This job";
  if (baseline.label) return baseline.label;
  return baseline.jobUrl ? historyJobDisplayName(baseline.jobUrl, environmentUrl) : "None selected";
}

function baselineDetail(model: HistoryViewModel): string {
  const baseline = model.baseline;
  if (!baseline) return "";
  const parts: string[] = [];
  if (baseline.build) {
    const anchor =
      model.selectedBuild === undefined ? "the selected build" : `#${model.selectedBuild}`;
    parts.push(
      `Build #${baseline.build.number}`,
      `started ${formatHistoryTimestamp(baseline.build.timestamp)}`,
      `last completed before ${anchor} started`
    );
  }
  if (baseline.message) parts.push(baseline.message);
  if (baseline.truncated) parts.push("Searched the first 500 build summaries");
  return parts.join(" · ");
}

export function HistoryBaselineSection({
  model,
  send
}: {
  model: HistoryViewModel;
  send: HistorySend;
}) {
  const baseline = model.baseline;
  const custom = Boolean(baseline?.custom);
  const detail = baselineDetail(model);
  return (
    <section
      aria-label="Baseline"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Baseline job:</span>
          {baseline ? (
            <span className="font-medium">{baselineJobName(baseline, model.environmentUrl)}</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <RefreshIcon aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              Resolving…
            </span>
          )}
          {baseline?.automatic ? (
            <span className="text-xs text-muted-foreground" title={AUTOMATIC_BASELINE}>
              <span aria-hidden="true">(auto)</span>
              <span className="sr-only">({AUTOMATIC_BASELINE})</span>
            </span>
          ) : null}
          {baseline?.status === "error" ? (
            <Badge variant="failure" size="sm">
              Error
            </Badge>
          ) : null}
        </div>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {baseline?.build && model.selectedBuild !== undefined ? (
          <Button size="sm" onClick={() => send("compare", model.selectedBuild)}>
            Compare with baseline
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => send("baseline")}>
          Change baseline job…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!custom}
          title={custom ? "Return to the automatic baseline" : "No custom baseline job is set"}
          onClick={() => send("resetBaseline")}
        >
          Reset baseline
        </Button>
      </div>
    </section>
  );
}
