import * as React from "react";
import { formatUpdatedAtLabel } from "../../../formatters/RelativeTimeFormatters";
import { PanelErrorList } from "../../shared/webview/components/PanelErrorList";
import { PanelHeader } from "../../shared/webview/components/PanelHeader";
import { PanelInitialLoadingGate } from "../../shared/webview/components/PanelInitialLoadingGate";
import { PanelLoadingBar } from "../../shared/webview/components/PanelLoadingBar";
import { Button } from "../../shared/webview/components/ui/button";
import { Toaster } from "../../shared/webview/components/ui/toaster";
import { TooltipProvider } from "../../shared/webview/components/ui/tooltip";
import { useOpenExternalMessage } from "../../shared/webview/hooks/useOpenExternalMessage";
import { ExternalLinkIcon, ServerIcon } from "../../shared/webview/icons";
import { resolveNodeStatusStyle } from "../../shared/webview/lib/statusStyles";
import {
  getVsCodeState,
  postVsCodeMessage,
  setVsCodeState
} from "../../shared/webview/lib/vscodeApi";
import type { NodeDetailsIncomingMessage } from "../shared/NodeDetailsPanelMessages";
import { isNodeDetailsPanelState } from "../shared/NodeDetailsPanelWebviewState";
import { NodeDetailsAlerts } from "./components/nodeDetails/NodeDetailsAlerts";
import type { NodeAction } from "./components/nodeDetails/NodeDetailsHero";
import { NodeDetailsHero } from "./components/nodeDetails/NodeDetailsHero";
import { NodeDetailsTabs } from "./components/nodeDetails/NodeDetailsTabs";
import { isStaleUpdatedAt, parseDate } from "./components/nodeDetails/nodeDetailsUtils";
import { useNodeDetailsMessages } from "./hooks/useNodeDetailsMessages";
import { loadAdvancedNodeDetailsForTab, type NodeDetailsTab } from "./nodeDetailsTabValues";
import {
  getInitialState,
  type NodeDetailsState,
  nodeDetailsReducer
} from "./state/nodeDetailsState";

const { useEffect, useMemo, useReducer, useState } = React;
export function NodeDetailsApp(): React.JSX.Element {
  const [state, dispatch] = useReducer(nodeDetailsReducer, undefined, getInitialState);
  const [now, setNow] = useState(() => Date.now());
  const postMessage: (message: NodeDetailsIncomingMessage) => void = postVsCodeMessage;
  const handleOpenExternal = useOpenExternalMessage(postMessage);

  useNodeDetailsMessages(dispatch);

  useEffect(() => {
    const preferences = getVsCodeState();
    if (isNodeDetailsPanelState(preferences)) {
      setVsCodeState({
        ...preferences,
        activeTab: state.activeTab,
        logFollowing: state.agentLog.following
      });
    }
    postMessage({ type: "setNodeAgentLogFollowing", following: state.agentLog.following });
    postMessage({ type: "setNodeDetailsTab", tab: state.activeTab });
  }, [state.activeTab, state.agentLog.following]);

  const updatedAtDate = useMemo(() => parseDate(state.updatedAt), [state.updatedAt]);
  const updatedAtLabel = useMemo(
    () => formatUpdatedAtLabel(updatedAtDate, now),
    [updatedAtDate, now]
  );
  const updatedAtTitle = useMemo(
    () => (updatedAtDate ? updatedAtDate.toLocaleString() : "Unknown"),
    [updatedAtDate]
  );
  const isStale = useMemo(() => isStaleUpdatedAt(updatedAtDate, now), [updatedAtDate, now]);
  const showOfflineBanner = state.statusClass === "offline" || state.statusClass === "temporary";
  const statusAccent = resolveNodeStatusStyle(state.statusClass).accent;
  const nodeAction = useMemo(
    () => resolveNodeAction(state.canTakeOffline, state.canBringOnline),
    [state.canTakeOffline, state.canBringOnline]
  );

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
  };

  const requestAdvancedDetails = () => {
    dispatch({ type: "advancedRequested" });
    postMessage({ type: "loadAdvancedNodeDetails" });
  };

  const handleDiagnosticsToggle = (value: NodeDetailsTab) => {
    dispatch({ type: "selectTab", tab: value });
    loadAdvancedNodeDetailsForTab(
      value,
      state.advancedLoaded || state.advancedRequested,
      requestAdvancedDetails
    );
  };

  // Nothing loaded yet and the load failed: show one failure view instead of
  // an "Unknown" node with empty labels, executors, and queue.
  if (!state.detailsAvailable && state.errors.length > 0) {
    return <NodeDetailsUnavailable state={state} onOpen={handleOpen} onRefresh={handleRefresh} />;
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen flex flex-col bg-background text-foreground">
        <PanelLoadingBar loading={state.loading} />
        <NodeDetailsHero
          environmentLabel={state.environmentLabel}
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
          isOffline={state.isOffline}
          offlineReason={state.offlineReason}
          offlineSinceMs={state.offlineSinceMs}
          executors={state.executors}
          oneOffExecutors={state.oneOffExecutors}
          executorsLabel={state.executorsLabel}
          activityLabel={state.activityLabel}
          onRefresh={handleRefresh}
          onNodeAction={handleNodeAction}
          onLaunchAgent={handleLaunchAgent}
          onOpen={handleOpen}
          canManageNode={state.canManageNode ?? false}
          canDisconnectAgent={state.canDisconnectAgent ?? false}
          onManagementAction={(type) => postMessage({ type })}
        />
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-3" aria-busy={state.loading}>
          <NodeDetailsAlerts
            errors={state.errors}
            refreshFailed={state.refreshFailed}
            loading={state.loading}
            onRetry={handleRefresh}
          />

          <NodeDetailsTabs
            state={state}
            onDiagnosticsToggle={handleDiagnosticsToggle}
            onRetryDiagnostics={requestAdvancedDetails}
            onCopyJson={handleCopyJson}
            onOpenExternal={handleOpenExternal}
            onLogFollow={() =>
              postMessage({
                type: "setNodeAgentLogFollowing",
                following: !state.agentLog.following
              })
            }
            onLogRefresh={() => postMessage({ type: "refreshNodeAgentLog" })}
            onLogCopy={() => postMessage({ type: "copyNodeAgentLog" })}
          />
        </main>
        <Toaster />
      </div>
    </TooltipProvider>
  );
}

function resolveNodeAction(
  canTakeOffline: boolean,
  canBringOnline: boolean
): NodeAction | undefined {
  if (canTakeOffline) {
    return { type: "takeNodeOffline", label: "Take offline…" };
  }
  if (canBringOnline) {
    return { type: "bringNodeOnline", label: "Bring online" };
  }
  return undefined;
}

function NodeDetailsUnavailable({
  state,
  onOpen,
  onRefresh
}: {
  state: NodeDetailsState;
  onOpen: () => void;
  onRefresh: () => void;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PanelLoadingBar loading={state.loading} />
      <PanelHeader
        eyebrowIcon={<ServerIcon className="h-3.5 w-3.5" />}
        eyebrow={state.environmentLabel}
        title="Node details unavailable"
        actions={
          state.url ? (
            <Button variant="secondary" size="sm" onClick={onOpen}>
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              Open in Jenkins
            </Button>
          ) : undefined
        }
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-4" aria-busy={state.loading}>
        <PanelErrorList
          errors={state.errors}
          title="Couldn't load node details"
          className="flex flex-col gap-1"
          onRetry={onRefresh}
          retryDisabled={state.loading}
        />
      </main>
    </div>
  );
}
