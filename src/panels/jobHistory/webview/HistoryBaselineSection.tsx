import { Badge } from "../../shared/webview/components/ui/badge";
import { Button } from "../../shared/webview/components/ui/button";
import { type HistoryViewModel, historyJobDisplayName } from "../shared/HistoryContracts";
import type { HistorySend } from "./HistoryOutcomes";
import { formatHistoryTimestamp } from "./historyPresentation";

function baselineJobName(baseline: NonNullable<HistoryViewModel["baseline"]>): string {
  if (baseline.status === "self") return "This job";
  if (baseline.label) return baseline.label;
  return baseline.jobUrl ? historyJobDisplayName(baseline.jobUrl) : "None selected";
}

function baselineDetail(model: HistoryViewModel): string {
  const baseline = model.baseline;
  if (!baseline) return "Resolving baseline…";
  const parts: string[] = [];
  if (baseline.build) {
    parts.push(
      `Build #${baseline.build.number}`,
      formatHistoryTimestamp(baseline.build.timestamp),
      "latest to complete before the selected build started"
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
  return (
    <section
      aria-label="Baseline"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2"
    >
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Baseline job:</span>
          <span className="font-medium">{baseline ? baselineJobName(baseline) : "…"}</span>
          {baseline?.automatic ? (
            <span
              className="text-xs text-muted-foreground"
              title="Automatic default: the multibranch main or master branch"
            >
              (auto)
            </span>
          ) : null}
          {baseline?.status === "error" ? (
            <Badge variant="failure" size="sm">
              Error
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{baselineDetail(model)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {baseline?.build && model.selectedBuild !== undefined ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => send("compare", model.selectedBuild)}
          >
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
