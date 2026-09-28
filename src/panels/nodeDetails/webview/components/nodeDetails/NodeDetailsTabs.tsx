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
import {
  isNodeDetailsTab,
  NODE_DETAILS_TABS,
  type NodeDetailsTab
} from "../../nodeDetailsTabValues";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { NodeDetailsAdvancedSection } from "./NodeDetailsAdvancedSection";
import { NodeDetailsExecutorsSection } from "./NodeDetailsExecutorsSection";
import { NodeDetailsOverviewSection } from "./NodeDetailsOverviewSection";
import { NodeDetailsQueuedWorkSection } from "./NodeDetailsQueuedWorkSection";

const { useState } = React;

type NodeDetailsTabsProps = {
  state: NodeDetailsState;
  onDiagnosticsToggle: (value: NodeDetailsTab) => void;
  onRetryDiagnostics: () => void;
  onCopyJson: () => void;
  onOpenExternal: (url: string) => void;
};
export function NodeDetailsTabs({
  state,
  onDiagnosticsToggle,
  onRetryDiagnostics,
  onCopyJson,
  onOpenExternal
}: NodeDetailsTabsProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<NodeDetailsTab>(NODE_DETAILS_TABS.OVERVIEW);
  const queuedWorkCount = countQueuedWorkItems(state.queuedWork);

  const handleValueChange = (value: string) => {
    if (!isNodeDetailsTab(value)) {
      return;
    }
    setActiveTab(value);
    onDiagnosticsToggle(value);
  };

  return (
    <Tabs value={activeTab} onValueChange={handleValueChange} className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 bg-background px-4 py-1">
        <TabsList className="w-full justify-start">
          <TabsTrigger value={NODE_DETAILS_TABS.OVERVIEW} className="text-xs">
            <StatusIcon className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.EXECUTORS} className="text-xs">
            <CpuIcon className="h-3.5 w-3.5" />
            Executors
            <TabCountBadge count={state.executors.length + state.oneOffExecutors.length} />
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.QUEUE} className="text-xs">
            <ClockIcon className="h-3.5 w-3.5" />
            Queue
            <TabCountBadge
              count={queuedWorkCount}
              tone={queuedWorkCount > 0 ? "warning" : "neutral"}
            />
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.DIAGNOSTICS} className="text-xs">
            <GaugeIcon className="h-3.5 w-3.5" />
            Diagnostics
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value={NODE_DETAILS_TABS.OVERVIEW} className="space-y-3">
        <NodeDetailsOverviewSection
          state={state}
          onOpenExternal={onOpenExternal}
          onShowTab={handleValueChange}
        />
      </TabsContent>

      <TabsContent value={NODE_DETAILS_TABS.EXECUTORS} className="space-y-3">
        <NodeDetailsExecutorsSection
          executors={state.executors}
          oneOffExecutors={state.oneOffExecutors}
          isOffline={state.isOffline}
          onOpenExternal={onOpenExternal}
        />
      </TabsContent>

      <TabsContent value={NODE_DETAILS_TABS.QUEUE} className="space-y-3">
        <NodeDetailsQueuedWorkSection
          queuedWork={state.queuedWork}
          onOpenExternal={onOpenExternal}
        />
      </TabsContent>

      <TabsContent value={NODE_DETAILS_TABS.DIAGNOSTICS} className="space-y-3">
        <NodeDetailsAdvancedSection
          advancedLoaded={state.advancedLoaded}
          loading={state.loading}
          monitorData={state.monitorData}
          loadStatistics={state.loadStatistics}
          rawJson={state.rawJson}
          onCopyJson={onCopyJson}
          onRetry={onRetryDiagnostics}
        />
      </TabsContent>
    </Tabs>
  );
}
