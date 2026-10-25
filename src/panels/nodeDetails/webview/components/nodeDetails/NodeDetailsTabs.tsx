import * as React from "react";
import {
  countQueuedWorkItems,
  type NodeQueuedWorkViewModel
} from "../../../../../shared/queueWork/QueueWorkContracts";
import {
  TabCountBadge,
  type TabCountTone
} from "../../../../shared/webview/components/TabCountBadge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "../../../../shared/webview/components/ui/tabs";
import { ClockIcon, CpuIcon, GaugeIcon, StatusIcon } from "../../../../shared/webview/icons";
import { emptyNodeAgentLogState } from "../../../shared/NodeAgentLogContracts";
import {
  isNodeDetailsTab,
  NODE_DETAILS_TABS,
  type NodeDetailsTab
} from "../../nodeDetailsTabValues";
import type { NodeDetailsState } from "../../state/nodeDetailsState";
import { NodeAgentLogSection } from "./NodeAgentLogSection";
import { NodeDetailsAdvancedSection } from "./NodeDetailsAdvancedSection";
import { NodeDetailsExecutorsSection } from "./NodeDetailsExecutorsSection";
import { NodeDetailsOverviewSection } from "./NodeDetailsOverviewSection";
import { NodeDetailsQueuedWorkSection } from "./NodeDetailsQueuedWorkSection";

const { useRef } = React;

/**
 * Waiting work is normal, so the Queue count stays neutral unless an item
 * needs attention: stuck items use the failure tone, blocked ones warning.
 */
export function resolveQueueTabTone(queuedWork: NodeQueuedWorkViewModel): TabCountTone {
  const items = [
    ...queuedWork.matchingQueueItems,
    ...queuedWork.anyQueueItems,
    ...queuedWork.selfLabelQueueItems
  ];
  if (items.some((item) => item.stuck)) {
    return "failure";
  }
  return items.some((item) => item.blocked) ? "warning" : "neutral";
}

type NodeDetailsTabsProps = {
  state: NodeDetailsState;
  onDiagnosticsToggle: (value: NodeDetailsTab) => void;
  onRetryDiagnostics: () => void;
  onCopyJson: () => void;
  onOpenExternal: (url: string) => void;
  onLogFollow?: () => void;
  onLogRefresh?: () => void;
  onLogCopy?: () => void;
};
export function NodeDetailsTabs({
  state,
  onDiagnosticsToggle,
  onRetryDiagnostics,
  onCopyJson,
  onOpenExternal,
  onLogFollow,
  onLogRefresh,
  onLogCopy
}: NodeDetailsTabsProps): React.JSX.Element {
  const activeTab = state.activeTab ?? NODE_DETAILS_TABS.OVERVIEW;
  // Radix reports one mouse click twice (focus, then mousedown) before React
  // re-renders, so compare against a ref rather than the rendered state.
  const activeTabRef = useRef<NodeDetailsTab>(activeTab);
  const queuedWorkCount = countQueuedWorkItems(state.queuedWork);

  const handleValueChange = (value: string) => {
    if (!isNodeDetailsTab(value) || value === activeTabRef.current) {
      return;
    }
    activeTabRef.current = value;
    onDiagnosticsToggle(value);
  };

  return (
    <Tabs value={activeTab} onValueChange={handleValueChange} className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-background px-4 py-1">
        <TabsList className="w-max min-w-full justify-start">
          <TabsTrigger value={NODE_DETAILS_TABS.OVERVIEW} className="text-xs">
            <StatusIcon className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.EXECUTORS} className="text-xs">
            <CpuIcon className="h-3.5 w-3.5" />
            Executors
            {/* Matches the hero's busy/idle counts; one-off executors are listed
                separately in the tab. */}
            <TabCountBadge count={state.executors.length} />
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.QUEUE} className="text-xs">
            <ClockIcon className="h-3.5 w-3.5" />
            Queue
            <TabCountBadge count={queuedWorkCount} tone={resolveQueueTabTone(state.queuedWork)} />
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.DIAGNOSTICS} className="text-xs">
            <GaugeIcon className="h-3.5 w-3.5" />
            Diagnostics
          </TabsTrigger>
          <TabsTrigger value={NODE_DETAILS_TABS.AGENT_LOG} className="text-xs">
            Agent Log
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

      <TabsContent value={NODE_DETAILS_TABS.AGENT_LOG} className="space-y-3">
        <NodeAgentLogSection
          state={state.agentLog ?? emptyNodeAgentLogState()}
          onFollow={onLogFollow}
          onRefresh={onLogRefresh}
          onCopy={onLogCopy}
        />
      </TabsContent>

      <TabsContent value={NODE_DETAILS_TABS.DIAGNOSTICS} className="space-y-3">
        <NodeDetailsAdvancedSection
          advancedLoaded={state.advancedLoaded}
          advancedRequested={state.advancedRequested}
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
