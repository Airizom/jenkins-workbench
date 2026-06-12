import * as React from "react";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { Progress } from "../../shared/webview/components/ui/progress";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { usePanelPostMessage } from "../../shared/webview/hooks/usePanelPostMessage";
import { toast } from "../../shared/webview/hooks/useToast";
import { resolveNodeStatusAccentClass } from "../../shared/webview/lib/statusStyles";
import type { NodeDetailsIncomingMessage } from "../shared/NodeDetailsPanelMessages";
import { NodeDetailsAlerts } from "./components/nodeDetails/NodeDetailsAlerts";
import { NodeDetailsHero } from "./components/nodeDetails/NodeDetailsHero";
import type { NodeAction } from "./components/nodeDetails/NodeDetailsHero";
import { NodeDetailsTabs } from "./components/nodeDetails/NodeDetailsTabs";
import {
  buildOverviewRows,
  formatRelativeTime,
  isStaleUpdatedAt,
  parseDate
} from "./components/nodeDetails/nodeDetailsUtils";
import { useNodeDetailsMessages } from "./hooks/useNodeDetailsMessages";
import { getInitialState, nodeDetailsReducer } from "./state/nodeDetailsState";

const { useEffect, useMemo, useReducer, useState } = React;
export function NodeDetailsApp(): JSX.Element {
  const [state, dispatch] = useReducer(nodeDetailsReducer, undefined, getInitialState);
  const [now, setNow] = useState(() => Date.now());
  const postMessage = usePanelPostMessage<NodeDetailsIncomingMessage>();
  const handleOpenExternal = useOpenExternalMessage(postMessage);

  useNodeDetailsMessages(dispatch);

  const overviewRows = useMemo(() => buildOverviewRows(state), [state]);
  const updatedAtDate = useMemo(() => parseDate(state.updatedAt), [state.updatedAt]);
  const updatedAtLabel = useMemo(
    () => formatRelativeTime(updatedAtDate, now),
    [updatedAtDate, now]
  );
  const updatedAtTitle = useMemo(
    () => (updatedAtDate ? updatedAtDate.toLocaleString() : "Unknown"),
    [updatedAtDate]
  );
  const isStale = useMemo(() => isStaleUpdatedAt(updatedAtDate, now), [updatedAtDate, now]);
  const showOfflineBanner = state.statusClass === "offline" || state.statusClass === "temporary";
  const statusAccent = resolveNodeStatusAccentClass(state.statusClass);
  const nodeAction = useMemo<NodeAction | undefined>(() => {
    if (state.canTakeOffline) {
      return { type: "takeNodeOffline", label: "Take Offline..." };
    }
    if (state.canBringOnline) {
      return { type: "bringNodeOnline", label: "Bring Online" };
    }
    return undefined;
  }, [state.canTakeOffline, state.canBringOnline]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(intervalId);
  }, []);

  if (state.loading && !state.hasLoaded) {
    return (
      <PanelInitialLoadingGate loading={state.loading} hasLoaded={state.hasLoaded} variant="node" />
    );
  }

  const handleRefresh = () => {
    postMessage({ type: "refreshNodeDetails" });
  };

  const handleNodeAction = () => {
    if (!nodeAction) {
      return;
    }
    postMessage({ type: nodeAction.type });
  };

  const handleLaunchAgent = () => {
    if (!state.canLaunchAgent) {
      return;
    }
    postMessage({ type: "launchNodeAgent" });
  };

  const handleOpen = () => {
    if (!state.url) {
      return;
    }
    handleOpenExternal(state.url);
  };

  const handleCopyJson = () => {
    if (!state.rawJson) {
      return;
    }
    postMessage({ type: "copyNodeJson", content: state.rawJson });
    toast({
      title: "Copied",
      description: "Node JSON copied to clipboard.",
      variant: "success"
    });
  };

  const handleDiagnosticsToggle = (value: string) => {
    if (value === "diagnostics" && !state.advancedLoaded) {
      postMessage({ type: "loadAdvancedNodeDetails" });
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        {state.loading ? (
          <div className="fixed inset-x-0 top-0 z-50">
            <Progress indeterminate className="h-px rounded-none" />
          </div>
        ) : null}
        <NodeDetailsHero
          displayName={state.displayName}
          name={state.name}
          description={state.description}
          statusLabel={state.statusLabel}
          statusClass={state.statusClass}
          statusAccent={statusAccent}
          isStale={isStale}
          updatedAtLabel={updatedAtLabel}
          updatedAtTitle={updatedAtTitle}
          loading={state.loading}
          nodeAction={nodeAction}
          canLaunchAgent={state.canLaunchAgent}
          canOpenAgentInstructions={state.canOpenAgentInstructions}
          hasUrl={Boolean(state.url)}
          showOfflineBanner={showOfflineBanner}
          offlineReason={state.offlineReason}
          executors={state.executors}
          oneOffExecutors={state.oneOffExecutors}
          executorsLabel={state.executorsLabel}
          idleLabel={state.idleLabel}
          onRefresh={handleRefresh}
          onNodeAction={handleNodeAction}
          onLaunchAgent={handleLaunchAgent}
          onOpen={handleOpen}
        />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3" aria-busy={state.loading}>
          <NodeDetailsAlerts errors={state.errors} />

          <NodeDetailsTabs
            state={state}
            overviewRows={overviewRows}
            onDiagnosticsToggle={handleDiagnosticsToggle}
            onCopyJson={handleCopyJson}
            onOpenExternal={handleOpenExternal}
          />
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
