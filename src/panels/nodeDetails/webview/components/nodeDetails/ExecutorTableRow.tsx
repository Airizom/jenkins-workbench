import { cn } from "../../../../shared/webview/lib/utils";
import { TableCell, TableRow } from "../../../../shared/webview/components/ui/table";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

type ExecutorEntry = NodeDetailsState["executors"][number];

type ExecutorTableRowProps = {
  entry: ExecutorEntry;
  onOpenExternal: (url: string) => void;
};

export function ExecutorTableRow({ entry, onOpenExternal }: ExecutorTableRowProps): JSX.Element {
  const durationLabel = entry.workDurationLabel ?? "—";
  const hasWork = Boolean(entry.workLabel);
  const buildLabel = entry.workLabel ?? "Idle";
  const progressPercent =
    typeof entry.progressPercent === "number" ? entry.progressPercent : undefined;
  const progressLabel =
    entry.progressLabel ?? (progressPercent !== undefined ? `${progressPercent}%` : "—");

  return (
    <TableRow>
      <TableCell className="font-mono text-[11px] text-muted-foreground py-1.5 px-3">
        {entry.id}
      </TableCell>
      <TableCell className="py-1.5 px-3">
        <div className="flex flex-col">
          <span className={cn("text-xs", hasWork ? "text-foreground" : "text-muted-foreground")}>
            {buildLabel}
          </span>
          {!hasWork ? (
            <span className="text-[11px] text-muted-foreground">{entry.statusLabel}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground py-1.5 px-3">{durationLabel}</TableCell>
      <TableCell className="py-1.5 px-3">
        {progressPercent !== undefined ? (
          <div className="flex items-center gap-1.5">
            <div className="executor-progress-track w-20">
              <div className="executor-progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground">{progressLabel}</span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="py-1.5 px-3">
        {entry.workUrl ? (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-[11px] text-link hover:text-link-hover hover:underline"
            onClick={() => {
              if (entry.workUrl) {
                onOpenExternal(entry.workUrl);
              }
            }}
          >
            Open
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
