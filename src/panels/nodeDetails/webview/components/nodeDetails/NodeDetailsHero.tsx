import { NodeStatusBadge } from "../../../../shared/webview/components/NodeStatusBadge";
import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import {
  AlertTriangleIcon,
  ClockIcon,
  ExternalLinkIcon,
  LaunchIcon,
  RefreshIcon,
  ServerIcon
} from "../../../../shared/webview/icons";
import { resolveNodeStatusIconClass } from "../../../../shared/webview/lib/statusStyles";
import { cn } from "../../../../shared/webview/lib/utils";
import type { NodeExecutorViewModel, NodeStatusClass } from "../../../shared/NodeDetailsContracts";
import { ExecutorUtilizationSummary } from "./ExecutorUtilizationSummary";

export type NodeAction =
  | { type: "takeNodeOffline"; label: "Take Offline..." }
  | {
      type: "bringNodeOnline";
      label: "Bring Online";
    };

type NodeDetailsHeroProps = {
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
  offlineReason?: string;
  executors: NodeExecutorViewModel[];
  oneOffExecutors: NodeExecutorViewModel[];
  executorsLabel: string;
  idleLabel: string;
  onRefresh: () => void;
  onNodeAction: () => void;
  onLaunchAgent: () => void;
  onOpen: () => void;
};
export function NodeDetailsHero({
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
  offlineReason,
  executors,
  oneOffExecutors,
  executorsLabel,
  idleLabel,
  onRefresh,
  onNodeAction,
  onLaunchAgent,
  onOpen
}: NodeDetailsHeroProps): JSX.Element {
  const statusIconClass = resolveNodeStatusIconClass(statusClass);

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
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h1 className="text-lg font-semibold leading-tight truncate">{displayName}</h1>
                <NodeStatusBadge label={statusLabel} statusClass={statusClass} />
                {isStale ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-warning-border text-warning bg-warning-soft"
                  >
                    Stale
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>{name}</span>
                {description ? (
                  <>
                    <span aria-hidden="true" className="opacity-30">
                      ·
                    </span>
                    <span className="truncate">{description}</span>
                  </>
                ) : null}
                <span aria-hidden="true" className="opacity-30">
                  ·
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1">
                      <ClockIcon className="h-3 w-3" />
                      {updatedAtLabel}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{updatedAtTitle}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefresh}
                  disabled={loading}
                  aria-label="Refresh node details"
                  className="h-7 w-7 p-0"
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            {nodeAction ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onNodeAction}
                disabled={loading}
                className="h-7 px-2 text-xs"
              >
                {nodeAction.label}
              </Button>
            ) : null}
            {canLaunchAgent ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onLaunchAgent}
                disabled={loading}
                className="gap-1 h-7 px-2 text-xs"
              >
                <LaunchIcon className="h-3.5 w-3.5" />
                Launch
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpen}
              disabled={!hasUrl}
              aria-label={canOpenAgentInstructions ? "Open agent instructions" : "Open in Jenkins"}
              className="gap-1 h-7 px-2 text-xs"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {canOpenAgentInstructions ? "Instructions" : "Jenkins"}
              </span>
            </Button>
          </div>
        </div>

        {showOfflineBanner ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft px-3 py-2">
            <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="min-w-0 text-xs">
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
          idleLabel={idleLabel}
          isOffline={statusClass === "offline"}
        />
      </div>
      <div className={cn("h-0.5", statusAccent)} />
    </header>
  );
}
