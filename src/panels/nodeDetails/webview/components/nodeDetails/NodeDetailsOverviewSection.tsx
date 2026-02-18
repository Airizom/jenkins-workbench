import { Alert, AlertDescription } from "../../../../shared/webview/components/ui/alert";
import type { OverviewRow } from "./nodeDetailsUtils";

type NodeDetailsOverviewSectionProps = {
  rows: OverviewRow[];
  offlineReason?: string;
};

export function NodeDetailsOverviewSection({
  rows,
  offlineReason
}: NodeDetailsOverviewSectionProps): JSX.Element {
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center gap-2.5 rounded border border-mutedBorder bg-muted-soft px-3 py-2"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
              {row.icon}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {row.label}
              </div>
              <div className="text-xs font-semibold">{row.value}</div>
            </div>
          </div>
        ))}
      </div>
      {offlineReason ? (
        <Alert variant="warning" className="py-2">
          <AlertDescription className="text-xs">
            <span className="font-semibold">Offline reason: </span>
            {offlineReason}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
