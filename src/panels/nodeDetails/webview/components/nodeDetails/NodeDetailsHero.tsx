import type * as React from "react";
import { ToneBadge } from "../../../../shared/webview/components/ToneBadge";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import { AccessibleTooltip } from "../../../../shared/webview/components/ui/tooltip";
import {
  AlertTriangleIcon,
  ClockIcon,
  ExternalLinkIcon,
  LaunchIcon,
  RefreshIcon,
  ServerIcon
} from "../../../../shared/webview/icons";
import {
  resolveNodeStatusBadgeClass,
  resolveNodeStatusIconClass
} from "../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../shared/webview/lib/utils";
import type { NodeExecutorViewModel, NodeStatusClass } from "../../../shared/NodeDetailsContracts";
import { ExecutorUtilizationSummary } from "./ExecutorUtilizationSummary";

export type NodeAction =
  | { type: "takeNodeOffline"; label: "Take offline…" }
  | {
      type: "bringNodeOnline";
      label: "Bring online";
    };

/**
 * Disconnected nodes are a fault (error tone); nodes someone took temporarily
 * offline are intentional (warning tone). Matches the hero badge and accent.
 */
const OFFLINE_BANNER_TONES = {
  offline: {
    container: "border-failure-border bg-failure-soft",
    icon: "text-failure"
  },
  temporary: {
    container: "border-warning-border bg-warning-soft",
    icon: "text-warning"
  }
} as const;

type NodeDetailsHeroProps = {
  environmentLabel: string;
  displayName: string;
  name: string;
  description?: string;
  statusLabel: string;
  statusClass: NodeStatusClass;
  statusAccent: string;
  isStale: boolean;
  updatedAtLabel: string;
  updatedAtTitle: string;
  loading: boolean;
  nodeAction?: NodeAction;
  canLaunchAgent: boolean;
  canOpenAgentInstructions: boolean;
  hasUrl: boolean;
  showOfflineBanner: boolean;
  isOffline: boolean;
  offlineReason?: string;
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  executorsLabel: string;
  activityLabel: string;
  onRefresh: () => void;
  onNodeAction: () => void;
  onLaunchAgent: () => void;
  onOpen: () => void;
};
export function NodeDetailsHero({
  environmentLabel,
  displayName,
  name,
  description,
  statusLabel,
  statusClass,
  statusAccent,
  isStale,
  updatedAtLabel,
  updatedAtTitle,
  loading,
  nodeAction,
  canLaunchAgent,
  canOpenAgentInstructions,
  hasUrl,
  showOfflineBanner,
  isOffline,
  offlineReason,
  executors,
  oneOffExecutors,
  executorsLabel,
  activityLabel,
  onRefresh,
  onNodeAction,
  onLaunchAgent,
  onOpen
}: NodeDetailsHeroProps): React.JSX.Element {
  const statusIconClass = resolveNodeStatusIconClass(statusClass);
  // The subtitle repeats the node name only when it differs from the title.
  const showName = name.trim().length > 0 && name !== displayName;
  const bannerTone =
    statusClass === "offline" || statusClass === "temporary"
      ? OFFLINE_BANNER_TONES[statusClass]
      : OFFLINE_BANNER_TONES.offline;
  // One filled button at most: the action that resolves the current state.
  // Taking a healthy node offline and opening Jenkins stay secondary.
  const nodeActionIsPrimary = nodeAction?.type === "bringNodeOnline";

  return (
    <header className="node-hero" data-status={statusClass}>
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-3 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                "node-hero-icon flex h-10 w-10 shrink-0 items-center justify-center",
                statusIconClass
              )}
            >
              <ServerIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div
                className="truncate text-caption font-medium uppercase tracking-wider text-muted-foreground"
                title={environmentLabel}
              >
                {environmentLabel}
              </div>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h1
                  className="min-w-0 max-w-full truncate text-lg font-semibold leading-tight"
                  title={displayName}
                >
                  {displayName}
                </h1>
                <ToneBadge
                  label={statusLabel}
                  className={resolveNodeStatusBadgeClass(statusClass)}
                />
                {isStale ? (
                  <AccessibleTooltip
                    focusable
                    content="This snapshot has not refreshed recently. Refresh for current node state."
                  >
                    <Badge variant="warning" size="sm">
                      <AlertTriangleIcon className="h-3 w-3" aria-hidden="true" />
                      Stale
                    </Badge>
                  </AccessibleTooltip>
                ) : null}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                {showName ? <MetaItem>{name}</MetaItem> : null}
                {description ? (
                  <MetaItem separated={showName}>
                    <span className="min-w-0 truncate" title={description}>
                      {description}
                    </span>
                  </MetaItem>
                ) : null}
                <MetaItem separated={showName || Boolean(description)}>
                  <span className="inline-flex items-center gap-1" title={updatedAtTitle}>
                    <ClockIcon className="h-3 w-3" aria-hidden="true" />
                    {updatedAtLabel}
                    <span className="sr-only"> ({updatedAtTitle})</span>
                  </span>
                </MetaItem>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
              aria-label="Refresh node details"
            >
              <RefreshIcon className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
            {/* Instructions replace Open in Jenkins: both open the node page. */}
            <Button
              variant={canOpenAgentInstructions ? "default" : "outline"}
              size="sm"
              onClick={onOpen}
              disabled={!hasUrl}
              aria-label={
                canOpenAgentInstructions ? "Launch instructions in Jenkins" : "Open in Jenkins"
              }
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {canOpenAgentInstructions ? "Launch instructions" : "Open in Jenkins"}
              </span>
            </Button>
            {nodeAction ? (
              <Button
                variant={nodeActionIsPrimary ? "default" : "outline"}
                size="sm"
                onClick={onNodeAction}
                disabled={loading}
              >
                {nodeAction.label}
              </Button>
            ) : null}
            {canLaunchAgent ? (
              <Button variant="default" size="sm" onClick={onLaunchAgent} disabled={loading}>
                <LaunchIcon className="h-3.5 w-3.5" />
                Launch agent
              </Button>
            ) : null}
          </div>
        </div>

        {showOfflineBanner ? (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 shadow-xs",
              bannerTone.container
            )}
          >
            <AlertTriangleIcon
              className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", bannerTone.icon)}
              aria-hidden="true"
            />
            <div className="min-w-0 text-xs [overflow-wrap:anywhere]">
              <span className="font-semibold">{statusLabel}.</span>{" "}
              <span className="text-muted-foreground">
                {offlineReason ?? "Jenkins reported this node as offline."}
              </span>
            </div>
          </div>
        ) : null}

        <ExecutorUtilizationSummary
          executors={executors}
          oneOffExecutors={oneOffExecutors}
          executorsLabel={executorsLabel}
          activityLabel={activityLabel}
          isOffline={isOffline}
        />
      </div>
      <div className={cn("h-0.5", statusAccent)} />
    </header>
  );
}

function MetaItem({
  separated = false,
  children
}: {
  separated?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {separated ? (
        <span aria-hidden="true" className="opacity-30">
          ·
        </span>
      ) : null}
      {children}
    </span>
  );
}
