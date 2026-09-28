import type * as React from "react";
import { Progress } from "../../../../shared/webview/components/ui/progress";
import { TableCell, TableRow } from "../../../../shared/webview/components/ui/table";
import { cn } from "../../../../shared/webview/lib/utils";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { formatExecutorName } from "./executorUtilization";

type ExecutorEntry = NodeDetailsState["executors"][number];

type ExecutorTableRowProps = {
  entry: ExecutorEntry;
  /** A free executor on an offline node is unavailable, not idle. */
  isOffline?: boolean;
  onOpenExternal: (url: string) => void;
};

function resolveBuildLabel(entry: ExecutorEntry, busy: boolean, freeLabel: string): string {
  return entry.workLabel ?? (busy ? entry.statusLabel || "Busy" : freeLabel);
}

function resolveProgressPercent(entry: ExecutorEntry): number | undefined {
  return typeof entry.progressPercent === "number" ? entry.progressPercent : undefined;
}

function ExecutorStatusCell({
  busy,
  freeLabel
}: {
  busy: boolean;
  freeLabel: string;
}): React.JSX.Element {
  return (
    <TableCell className="py-1.5 pl-3 pr-0 w-4">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          busy ? "bg-progress" : "bg-muted-foreground/40"
        )}
      />
      <span className="sr-only">{busy ? "Busy" : freeLabel}</span>
    </TableCell>
  );
}

function ExecutorWorkCell({
  entry,
  busy,
  buildLabel
}: {
  entry: ExecutorEntry;
  busy: boolean;
  buildLabel: string;
}): React.JSX.Element {
  const showStatus = !busy && entry.statusLabel && entry.statusLabel !== buildLabel;
  return (
    <TableCell className="py-1.5 px-3">
      <div className="flex flex-col">
        <span
          className={cn("text-xs", busy ? "text-foreground" : "text-muted-foreground")}
          title={entry.workLabel}
        >
          {buildLabel}
        </span>
        {showStatus ? (
          <span className="text-[11px] text-muted-foreground">{entry.statusLabel}</span>
        ) : null}
      </div>
    </TableCell>
  );
}

function ExecutorProgressCell({ entry }: { entry: ExecutorEntry }): React.JSX.Element {
  const progressPercent = resolveProgressPercent(entry);
  if (progressPercent === undefined) {
    return (
      <TableCell className="py-1.5 px-3">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
    );
  }
  return (
    <TableCell className="py-1.5 px-3">
      <div className="flex items-center gap-1.5">
        <Progress value={progressPercent} className="h-1.5 w-28" />
        <span className="text-[11px] text-muted-foreground">
          {entry.progressLabel ?? `${progressPercent}%`}
        </span>
      </div>
    </TableCell>
  );
}

function ExecutorOpenCell({
  entry,
  onOpenExternal
}: {
  entry: ExecutorEntry;
  onOpenExternal: (url: string) => void;
}): React.JSX.Element {
  const workUrl = entry.workUrl;
  if (!workUrl) {
    return (
      <TableCell className="py-1.5 px-3">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
    );
  }
  return (
    <TableCell className="py-1.5 px-3">
      <button
        type="button"
        className="focus-ring inline-flex items-center gap-0.5 rounded-sm text-[11px] text-link hover:text-link-hover hover:underline"
        aria-label={`Open ${entry.workLabel ?? `${formatExecutorName(entry.id)} build`} in Jenkins`}
        onClick={() => onOpenExternal(workUrl)}
      >
        Open
      </button>
    </TableCell>
  );
}

export function ExecutorTableRow({
  entry,
  isOffline = false,
  onOpenExternal
}: ExecutorTableRowProps): React.JSX.Element {
  const busy = !entry.isIdle;
  const freeLabel = isOffline ? "Offline" : "Idle";
  const buildLabel = resolveBuildLabel(entry, busy, freeLabel);

  return (
    <TableRow>
      <ExecutorStatusCell busy={busy} freeLabel={freeLabel} />
      <TableCell className="font-mono text-[11px] text-muted-foreground py-1.5 px-3">
        {entry.id}
      </TableCell>
      <ExecutorWorkCell entry={entry} busy={busy} buildLabel={buildLabel} />
      <TableCell className="hidden md:table-cell text-xs text-muted-foreground py-1.5 px-3">
        {entry.workDurationLabel ?? "—"}
      </TableCell>
      <ExecutorProgressCell entry={entry} />
      <ExecutorOpenCell entry={entry} onOpenExternal={onOpenExternal} />
    </TableRow>
  );
}
