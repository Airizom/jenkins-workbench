import * as React from "react";
import { countQueuedWorkItems } from "../../../../../shared/queueWork/QueueWorkContracts";
import { TabCountBadge } from "../../../../shared/webview/components/TabCountBadge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "../../../../shared/webview/components/ui/tabs";
import { ClockIcon, CpuIcon, GaugeIcon, StatusIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { NodeDetailsAdvancedSection } from "./NodeDetailsAdvancedSection";
import { NodeDetailsExecutorsSection } from "./NodeDetailsExecutorsSection";
import { NodeDetailsOverviewSection } from "./NodeDetailsOverviewSection";
import { NodeDetailsQueuedWorkSection } from "./NodeDetailsQueuedWorkSection";
import type { OverviewRow } from "./nodeDetailsUtils";

const { useState } = React;

type NodeDetailsTabsProps = {
  state: NodeDetailsState;
  overviewRows: OverviewRow[];
  onDiagnosticsToggle: (value: string) => void;
  onCopyJson: () => void;
  onOpenExternal: (url: string) => void;
};
export function NodeDetailsTabs({
  state,
  overviewRows,
  onDiagnosticsToggle,
  onCopyJson,
  onOpenExternal
}: NodeDetailsTabsProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState("overview");
  const queuedWorkCount = countQueuedWorkItems(state.queuedWork);

  // The "diagnostics" tab value is load-bearing: the App's handler posts
  // loadAdvancedNodeDetails when it sees that exact string.
  const handleValueChange = (value: string) => {
    setActiveTab(value);
    onDiagnosticsToggle(value);
  };

  return (
    <Tabs value={activeTab} onValueChange={handleValueChange} className="space-y-3">
      <div className="sticky-header -mx-4 px-4 py-1">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview" className="text-xs">
            <StatusIcon className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="executors" className="text-xs">
            <CpuIcon className="h-3.5 w-3.5" />
            Executors
            <TabCountBadge count={state.executors.length + state.oneOffExecutors.length} />
          </TabsTrigger>
          <TabsTrigger value="queue" className="text-xs">
            <ClockIcon className="h-3.5 w-3.5" />
            Queue
            <TabCountBadge
              count={queuedWorkCount}
              tone={queuedWorkCount > 0 ? "warning" : "neutral"}
            />
          </TabsTrigger>
          <TabsTrigger value="diagnostics" className="text-xs">
            <GaugeIcon className="h-3.5 w-3.5" />
            Diagnostics
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="space-y-3">
        <NodeDetailsOverviewSection
          state={state}
          overviewRows={overviewRows}
          onOpenExternal={onOpenExternal}
          onShowTab={handleValueChange}
        />
      </TabsContent>

      <TabsContent value="executors" className="space-y-3">
        <NodeDetailsExecutorsSection
          executors={state.executors}
          oneOffExecutors={state.oneOffExecutors}
          onOpenExternal={onOpenExternal}
        />
      </TabsContent>

      <TabsContent value="queue" className="space-y-3">
        <NodeDetailsQueuedWorkSection
          queuedWork={state.queuedWork}
          onOpenExternal={onOpenExternal}
        />
      </TabsContent>

      <TabsContent value="diagnostics" className="space-y-3">
        <NodeDetailsAdvancedSection
          advancedLoaded={state.advancedLoaded}
          loading={state.loading}
          monitorData={state.monitorData}
          loadStatistics={state.loadStatistics}
          rawJson={state.rawJson}
          onCopyJson={onCopyJson}
        />
      </TabsContent>
    </Tabs>
  );
}
