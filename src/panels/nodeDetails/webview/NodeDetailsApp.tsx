import * as React from "react";
import { LoadingSkeleton } from "../../shared/webview/components/ui/loading-skeleton";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { toast } from "../../shared/webview/hooks/useToast";
import { postVsCodeMessage } from "../../shared/webview/lib/vscodeApi";
import type { NodeDetailsIncomingMessage } from "../shared/NodeDetailsPanelMessages";
import { useNodeDetailsMessages } from "./hooks/useNodeDetailsMessages";
import {
  type NodeDetailsState,
  getInitialState,
  nodeDetailsReducer
} from "./state/nodeDetailsState";
import {
  buildOverviewRows,
  formatRelativeTime,
  isStaleUpdatedAt,
  parseDate
} from "./components/nodeDetails/nodeDetailsUtils";
import { NodeDetailsAlerts } from "./components/nodeDetails/NodeDetailsAlerts";
import { NodeDetailsHeader } from "./components/nodeDetails/NodeDetailsHeader";
import { NodeDetailsTabs } from "./components/nodeDetails/NodeDetailsTabs";
import type { NodeAction } from "./components/nodeDetails/NodeDetailsHeader";

const { useEffect, useMemo, useReducer, useState } = React;

const STATUS_ACCENT: Record<NodeDetailsState["statusClass"], string> = {
  online: "bg-success",
  idle: "bg-warning",
  temporary: "bg-warning",
  offline: "bg-failure",
  unknown: "bg-border"
};

function postNodeDetailsMessage(message: NodeDetailsIncomingMessage): void {
  postVsCodeMessage(message);
}

export function NodeDetailsApp(): JSX.Element {
  const [state, dispatch] = useReducer(nodeDetailsReducer, undefined, getInitialState);
  const [now, setNow] = useState(() => Date.now());

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
  const statusAccent = STATUS_ACCENT[state.statusClass];
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
    return <LoadingSkeleton variant="node" />;
  }

  const handleRefresh = () => {
    postNodeDetailsMessage({ type: "refreshNodeDetails" });
  };

  const handleNodeAction = () => {
    if (!nodeAction) {
      return;
    }
    postNodeDetailsMessage({ type: nodeAction.type });
  };

  const handleLaunchAgent = () => {
    if (!state.canLaunchAgent) {
      return;
    }
    postNodeDetailsMessage({ type: "launchNodeAgent" });
  };

  const handleOpenExternal = (url: string) => {
    if (!url) {
      return;
    }
    postNodeDetailsMessage({ type: "openExternal", url });
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
    postNodeDetailsMessage({ type: "copyNodeJson", content: state.rawJson });
    toast({
      title: "Copied",
      description: "Node JSON copied to clipboard.",
      variant: "success"
    });
  };

  const handleDiagnosticsToggle = (value: string) => {
    if (value === "diagnostics" && !state.advancedLoaded) {
      postNodeDetailsMessage({ type: "loadAdvancedNodeDetails" });
    }
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <NodeDetailsHeader
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
          onRefresh={handleRefresh}
          onNodeAction={handleNodeAction}
          onLaunchAgent={handleLaunchAgent}
          onOpen={handleOpen}
        />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3" aria-busy={state.loading}>
          <NodeDetailsAlerts
            showOfflineBanner={showOfflineBanner}
            statusLabel={state.statusLabel}
            offlineReason={state.offlineReason}
            errors={state.errors}
          />

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
