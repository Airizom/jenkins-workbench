import { Skeleton } from "../../../../shared/webview/components/ui/skeleton";
import type { NodeMonitorViewModel } from "../../../shared/NodeDetailsContracts";
import { MonitorCard } from "./MonitorCard";
import { RawJsonCard } from "./RawJsonCard";

type NodeDetailsAdvancedSectionProps = {
  advancedLoaded: boolean;
  loading: boolean;
  monitorData: NodeMonitorViewModel[];
  loadStatistics: NodeMonitorViewModel[];
  rawJson: string;
  onCopyJson: () => void;
};
export function NodeDetailsAdvancedSection({
  advancedLoaded,
  loading,
  monitorData,
  loadStatistics,
  rawJson,
  onCopyJson
}: NodeDetailsAdvancedSectionProps): JSX.Element {
  return (
    <>
      {!advancedLoaded ? (
        loading ? (
          <div
            className="space-y-2 rounded-lg border border-mutedBorder bg-card p-4 shadow-widget"
            aria-label="Loading diagnostics"
          >
            <div className="text-xs text-muted-foreground">Loading diagnostics...</div>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-5/6" />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-mutedBorder bg-muted-soft px-3 py-6 text-center text-xs text-muted-foreground">
            Diagnostics have not loaded yet. Refresh to retry.
          </div>
        )
      ) : (
        <div className="space-y-3">
          <MonitorCard title="Monitors" entries={monitorData} />
          <MonitorCard title="Load Statistics" entries={loadStatistics} />
        </div>
      )}

      <RawJsonCard rawJson={rawJson} advancedLoaded={advancedLoaded} onCopyJson={onCopyJson} />
    </>
  );
}
