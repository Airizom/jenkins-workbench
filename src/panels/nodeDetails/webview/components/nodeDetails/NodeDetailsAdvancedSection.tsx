import type * as React from "react";
import { EmptyState } from "../../../../shared/webview/components/EmptyState";
import { Skeleton } from "../../../../shared/webview/components/ui/skeleton";
import { GaugeIcon } from "../../../../shared/webview/icons";
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
}: NodeDetailsAdvancedSectionProps): React.JSX.Element {
  let diagnosticsContent: React.JSX.Element;

  if (advancedLoaded) {
    diagnosticsContent = (
      <div className="space-y-3">
        <MonitorCard title="Monitors" entries={monitorData} />
        <MonitorCard title="Load Statistics" entries={loadStatistics} />
      </div>
    );
  } else if (loading) {
    diagnosticsContent = (
      <div
        className="space-y-2 rounded-lg border border-card-border bg-card p-4 shadow-sm"
        aria-label="Loading diagnostics"
        role="status"
      >
        <div className="text-xs text-muted-foreground">Loading diagnostics...</div>
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-5/6" />
      </div>
    );
  } else {
    diagnosticsContent = (
      <EmptyState
        icon={<GaugeIcon className="h-4 w-4" />}
        title="Diagnostics not loaded"
        description="Monitor and load statistics have not been fetched yet. Refresh to retry."
        className="py-6"
      />
    );
  }

  return (
    <>
      {diagnosticsContent}
      <RawJsonCard rawJson={rawJson} advancedLoaded={advancedLoaded} onCopyJson={onCopyJson} />
    </>
  );
}
