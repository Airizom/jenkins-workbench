import { PanelHeader } from "../../../../shared/webview/components/PanelHeader";
import { Button } from "../../../../shared/webview/components/ui/button";
import { RefreshIcon } from "../../../../shared/webview/icons";
import { cn } from "../../../../shared/webview/lib/utils";
import type { BuildCompareBuildViewModel } from "../../../shared/BuildCompareContracts";
import type { BuildCompareBusyAction } from "../../state/buildCompareState";
import { resolveSharedJobName } from "./buildIdentity";

function BuildReference({
  build,
  showJob
}: {
  build: BuildCompareBuildViewModel;
  showJob: boolean;
}) {
  const jobName = showJob ? build.jobDisplayName : undefined;
  return (
    // Only a visible job name may shrink (wrapping on narrow panels); "#N" is never clipped.
    <span
      className={cn("flex items-baseline gap-1", jobName ? "min-w-0" : "shrink-0")}
      title={build.displayName}
    >
      {jobName ? (
        <span className="min-w-0 font-normal [overflow-wrap:anywhere]">{jobName}</span>
      ) : null}
      <span className="shrink-0 tabular-nums">{build.buildNumberLabel}</span>
    </span>
  );
}

export function BuildCompareHeader({
  baseline,
  target,
  busy,
  busyAction,
  onRefresh,
  onSwap
}: {
  baseline: BuildCompareBuildViewModel;
  target: BuildCompareBuildViewModel;
  /** A refresh, swap, or section load that blocks both actions; the console scan does not. */
  busy: boolean;
  busyAction?: BuildCompareBusyAction;
  onRefresh: () => void;
  onSwap: () => void;
}) {
  const sharedJobName = resolveSharedJobName(baseline, target);
  const refreshing = busyAction === "refresh";
  const swapping = busyAction === "swap";
  return (
    <PanelHeader
      maxWidthClassName="max-w-7xl"
      eyebrow="Build Compare"
      // Long job paths wrap instead of being clipped on narrow panels.
      wrapTitle
      titleTooltip={`${baseline.displayName} vs ${target.displayName}`}
      title={
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {sharedJobName ? (
            // Narrow panels put the job on its own line so it wraps instead of truncating away.
            <span className="min-w-0 basis-full [overflow-wrap:anywhere] sm:basis-auto">
              {sharedJobName}
            </span>
          ) : null}
          <BuildReference build={baseline} showJob={!sharedJobName} />
          <span
            aria-hidden="true"
            className="shrink-0 self-center rounded-full border border-border bg-muted-strong px-1.5 text-caption font-normal text-muted-foreground"
          >
            vs
          </span>
          <span className="sr-only">compared to</span>
          <BuildReference build={target} showJob={!sharedJobName} />
        </span>
      }
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={busy}
            aria-label={refreshing ? "Refreshing comparison" : "Refresh comparison"}
          >
            <RefreshIcon className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={onSwap} disabled={busy}>
            {swapping ? "Swapping…" : "Swap sides"}
          </Button>
        </>
      }
    />
  );
}
