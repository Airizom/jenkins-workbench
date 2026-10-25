import * as React from "react";
import type {
  NodeCapacityExecutorViewModel,
  NodeCapacityNodeViewModel
} from "../../../../shared/nodeCapacity/NodeCapacityContracts";
import { EmptyState } from "../../../shared/webview/components/EmptyState";
import { SectionHeading } from "../../../shared/webview/components/SectionHeading";
import { ToneBadge } from "../../../shared/webview/components/ToneBadge";
import { Badge } from "../../../shared/webview/components/ui/badge";
import { Button } from "../../../shared/webview/components/ui/button";
import { ClampedText } from "../../../shared/webview/components/ui/clamped-text";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../shared/webview/components/ui/tooltip";
import { TruncatedText } from "../../../shared/webview/components/ui/truncated-text";
import { AlertTriangleIcon, ExternalLinkIcon, ServerIcon } from "../../../shared/webview/icons";
import { resolveNodeStatusStyle } from "../../../shared/webview/lib/statusStyles";
import { cn } from "../../../shared/webview/lib/utils";
import type {
  OpenBuildDetailsHandler,
  OpenExternalHandler,
  OpenNodeDetailsHandler,
  RetryExecutorsHandler
} from "./NodeCapacityViewTypes";

/**
 * Memoized so toggling a pool open/closed does not re-render every node row;
 * capacity data updates always replace the `nodes` array, so real changes
 * still re-render.
 */
export const NodeCapacityNodeList = React.memo(function NodeCapacityNodeList({
  nodes,
  totalCount,
  poolNodeCount,
  capped,
  canCollapse,
  wide,
  onShowAllChange,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onOpenExternal,
  onRetryExecutors
}: {
  nodes: readonly NodeCapacityNodeViewModel[];
  /** Nodes that pass the filter. */
  totalCount: number;
  /** Every node in the pool, to say when the filter narrowed the list. */
  poolNodeCount: number;
  /** More nodes exist than `nodes` shows. */
  capped: boolean;
  /** Every node shows and the list could be capped again. */
  canCollapse: boolean;
  /** Full width (no queue column), so rows flow into two columns. */
  wide: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element {
  if (totalCount === 0) {
    return (
      <section>
        <SectionHeading title="Nodes" icon={<ServerIcon className="h-3.5 w-3.5" />} />
        <EmptyState
          tone="failure"
          icon={<AlertTriangleIcon className="h-4 w-4" />}
          title="No nodes provide this label"
          description="Queued builds requesting it cannot start until a matching agent comes online."
        />
      </section>
    );
  }

  return (
    <section>
      <SectionHeading
        title="Nodes"
        icon={<ServerIcon className="h-3.5 w-3.5" />}
        count={
          totalCount < poolNodeCount ? (
            // The heading is uppercase; keep "of" readable.
            <span className="normal-case">
              {totalCount} of {poolNodeCount}
            </span>
          ) : (
            totalCount
          )
        }
      />
      <div className={cn("gap-2", wide ? "grid lg:grid-cols-2" : "flex flex-col")}>
        {nodes.map((node) => (
          <NodeRow
            key={node.nodeUrl ?? node.name}
            node={node}
            onOpenNodeDetails={onOpenNodeDetails}
            onOpenBuildDetails={onOpenBuildDetails}
            onOpenExternal={onOpenExternal}
            onRetryExecutors={onRetryExecutors}
          />
        ))}
      </div>
      {capped || canCollapse ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => onShowAllChange(capped)}>
          {capped ? `Show all ${totalCount} nodes` : "Show fewer nodes"}
        </Button>
      ) : null}
    </section>
  );
});

type NodeOfflineTone = "offline" | "temporary";

/**
 * Same tones as Node Details: disconnected is a fault, temporarily offline is
 * intentional. A left accent plus the status badge marks the row; a full tint
 * would stack a third red/yellow layer inside an already-toned pool.
 */
const NODE_OFFLINE_ACCENT_CLASSES: Record<NodeOfflineTone, string> = {
  offline: "border-l-failure",
  temporary: "border-l-warning"
};

function resolveNodeOfflineTone(node: NodeCapacityNodeViewModel): NodeOfflineTone | undefined {
  if (!node.isOffline) {
    return undefined;
  }
  return node.isTemporarilyOffline ? "temporary" : "offline";
}

function NodeRow({
  node,
  onOpenNodeDetails,
  onOpenBuildDetails,
  onOpenExternal,
  onRetryExecutors
}: {
  node: NodeCapacityNodeViewModel;
  onOpenNodeDetails: OpenNodeDetailsHandler;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element {
  const offlineTone = resolveNodeOfflineTone(node);
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-border bg-surface-sunken p-3",
        offlineTone && cn("border-l-2", NODE_OFFLINE_ACCENT_CLASSES[offlineTone])
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <NodeName node={node} onOpenNodeDetails={onOpenNodeDetails} />
            {offlineTone ? (
              <ToneBadge
                label={node.statusLabel}
                className={resolveNodeStatusStyle(offlineTone).badge}
              />
            ) : (
              <Badge variant="muted">{node.statusLabel}</Badge>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{node.executorSummary}</div>
          {node.offlineReason ? (
            <ClampedText
              text={node.offlineReason}
              className="mt-1"
              textClassName="text-xs text-muted-foreground"
            />
          ) : null}
          <NodeRunningWork
            node={node}
            onOpenBuildDetails={onOpenBuildDetails}
            onOpenExternal={onOpenExternal}
            onRetryExecutors={onRetryExecutors}
          />
        </div>
        {node.nodeUrl ? (
          <OpenInJenkinsButton
            label={`Open ${node.displayName} in Jenkins`}
            onClick={() => node.nodeUrl && onOpenExternal(node.nodeUrl)}
          />
        ) : null}
      </div>
    </div>
  );
}

function OpenInJenkinsButton({
  label,
  size = "icon",
  onClick
}: {
  label: string;
  size?: "icon" | "icon-sm";
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          variant="ghost"
          size={size}
          className={cn(
            "shrink-0 text-muted-foreground hover:text-foreground",
            size === "icon-sm" && "h-5 w-5"
          )}
          onClick={onClick}
        >
          <ExternalLinkIcon className={size === "icon" ? "h-4 w-4" : "h-3 w-3"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open in Jenkins</TooltipContent>
    </Tooltip>
  );
}

/** The node name doubles as the Node Details link, so each row keeps one icon action. */
function NodeName({
  node,
  onOpenNodeDetails
}: {
  node: NodeCapacityNodeViewModel;
  onOpenNodeDetails: OpenNodeDetailsHandler;
}): React.JSX.Element {
  const nodeUrl = node.nodeUrl;
  if (!nodeUrl) {
    return <TruncatedText text={node.displayName} className="text-sm font-medium" />;
  }
  return (
    <button
      type="button"
      className="focus-ring min-w-0 max-w-full truncate rounded-sm text-left text-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline"
      title={`${node.displayName} (open node details)`}
      onClick={() => onOpenNodeDetails(nodeUrl, node.displayName)}
    >
      {node.displayName}
      <span className="sr-only">, open node details</span>
    </button>
  );
}

function NodeRunningWork({
  node,
  onOpenBuildDetails,
  onOpenExternal,
  onRetryExecutors
}: {
  node: NodeCapacityNodeViewModel;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
  onRetryExecutors: RetryExecutorsHandler;
}): React.JSX.Element | null {
  const hasLoadedBusyWork =
    node.executorsLoaded && node.executors.some((executor) => !executor.isIdle);
  // Offline nodes only list work while a draining build is still running; keep
  // request status visible while that work is loading, failed, or stale.
  if (node.isOffline && !hasLoadedBusyWork && node.busyExecutors === 0) {
    return null;
  }
  const nodeUrl = node.nodeUrl;
  if (node.executorsLoadState === "error" && nodeUrl) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-failure-foreground">
        <span title={node.executorsError}>
          Couldn't load running work
          {node.executorsError ? <span className="sr-only">: {node.executorsError}</span> : null}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        <button
          type="button"
          className="focus-ring rounded-sm text-link hover:text-link-hover hover:underline"
          aria-label={`Retry loading running work on ${node.displayName}`}
          onClick={() => onRetryExecutors(nodeUrl)}
        >
          Retry
        </button>
      </div>
    );
  }
  if (node.executorsLoaded) {
    return (
      <ExecutorWorkList
        node={node}
        onOpenBuildDetails={onOpenBuildDetails}
        onOpenExternal={onOpenExternal}
      />
    );
  }
  if (node.executorsLoadState === "loading") {
    return <div className="mt-2 text-xs text-muted-foreground">Loading running work…</div>;
  }
  return null;
}

/** Jenkins build URLs end in the build number, e.g. `/job/api/job/main/7/`. */
const BUILD_URL_PATTERN = /\/\d+\/?$/;

function ExecutorWorkList({
  node,
  onOpenBuildDetails,
  onOpenExternal
}: {
  node: NodeCapacityNodeViewModel;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  const busyExecutors = node.executors.filter((executor) => !executor.isIdle);
  if (busyExecutors.length === 0) {
    return <div className="mt-2 text-xs text-muted-foreground">No builds running.</div>;
  }

  return (
    <ul className="mt-2 m-0 list-none space-y-0.5 border-l border-border p-0 pl-2.5">
      {busyExecutors.map((executor) => (
        <li key={executor.id} className="flex min-w-0 items-center gap-2 text-xs">
          <span className="w-6 shrink-0 text-caption tabular-nums text-muted-foreground">
            {executor.id}
          </span>
          <ExecutorWork
            executor={executor}
            nodeName={node.displayName}
            onOpenBuildDetails={onOpenBuildDetails}
            onOpenExternal={onOpenExternal}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Same pattern as a node row: the name opens the in-editor details panel and
 * a separate icon opens Jenkins. Work that is not a build URL only opens Jenkins.
 */
function ExecutorWork({
  executor,
  nodeName,
  onOpenBuildDetails,
  onOpenExternal
}: {
  executor: NodeCapacityExecutorViewModel;
  nodeName: string;
  onOpenBuildDetails: OpenBuildDetailsHandler;
  onOpenExternal: OpenExternalHandler;
}): React.JSX.Element {
  const label = executor.workLabel ?? executor.statusLabel;
  const workUrl = executor.workUrl;
  if (!workUrl) {
    return <TruncatedText text={label} />;
  }
  const linkClassName =
    "focus-ring min-w-0 truncate rounded-sm text-left text-link underline-offset-2 hover:text-link-hover hover:underline";
  if (!BUILD_URL_PATTERN.test(workUrl)) {
    return (
      <button
        type="button"
        className={linkClassName}
        aria-label={`Open ${label} in Jenkins (running on ${nodeName})`}
        title={label}
        onClick={() => onOpenExternal(workUrl)}
      >
        {label}
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className={linkClassName}
        title={`${label} (open build details)`}
        onClick={() => onOpenBuildDetails(workUrl, label)}
      >
        {label}
        <span className="sr-only">, running on {nodeName}, open build details</span>
      </button>
      <OpenInJenkinsButton
        label={`Open ${label} in Jenkins`}
        size="icon-sm"
        onClick={() => onOpenExternal(workUrl)}
      />
    </>
  );
}
