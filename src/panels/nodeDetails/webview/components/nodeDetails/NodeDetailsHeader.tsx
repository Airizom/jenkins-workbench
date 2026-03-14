import { Badge } from "../../../../shared/webview/components/ui/badge";
import { Button } from "../../../../shared/webview/components/ui/button";
import { Progress } from "../../../../shared/webview/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "../../../../shared/webview/components/ui/tooltip";
import {
  ClockIcon,
  ExternalLinkIcon,
  LaunchIcon,
  RefreshIcon,
  ServerIcon
} from "../../../../shared/webview/icons";
import { cn } from "../../../../shared/webview/lib/utils";
import type { NodeStatusClass } from "../../../shared/NodeDetailsContracts";

const STATUS_STYLES: Record<NodeStatusClass, { badge: string; icon: string }> = {
  online: {
    badge: "border-success-border text-success bg-success-soft",
    icon: "text-success"
  },
  idle: {
    badge: "border-warning-border text-warning bg-warning-soft",
    icon: "text-warning"
  },
  temporary: {
    badge: "border-warning-border text-warning bg-warning-soft",
    icon: "text-warning"
  },
  offline: {
    badge: "border-failure-border text-failure bg-failure-soft",
    icon: "text-failure"
  },
  unknown: {
    badge: "border-border text-foreground bg-muted",
    icon: "text-muted-foreground"
  }
};

export type NodeAction =
  | { type: "takeNodeOffline"; label: "Take Offline..." }
  | {
      type: "bringNodeOnline";
      label: "Bring Online";
    };

type NodeDetailsHeaderProps = {
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
  onRefresh: () => void;
  onNodeAction: () => void;
  onLaunchAgent: () => void;
  onOpen: () => void;
};

export function NodeDetailsHeader({
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
  onRefresh,
  onNodeAction,
  onLaunchAgent,
  onOpen
}: NodeDetailsHeaderProps): JSX.Element {
  const statusStyle = STATUS_STYLES[statusClass];

  return (
    <header className="sticky-header">
      {loading ? <Progress indeterminate className="h-px rounded-none" /> : null}
      <div className="mx-auto max-w-6xl px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted ${statusStyle.icon}`}
            >
              <ServerIcon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold leading-tight truncate">{displayName}</h1>
                <Badge
                  variant="outline"
                  className={cn("text-[10px] px-1.5 py-0", statusStyle.badge)}
                >
                  {statusLabel}
                </Badge>
                {isStale ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-warning-border text-warning bg-warning-soft"
                  >
                    Stale
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
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
              variant="ghost"
              size="sm"
              onClick={onOpen}
              disabled={!hasUrl}
              className="gap-1 h-7 px-2 text-xs"
            >
              <ExternalLinkIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {canOpenAgentInstructions ? "Instructions" : "Jenkins"}
              </span>
            </Button>
          </div>
        </div>
      </div>
      <div className={cn("h-px", statusAccent)} />
    </header>
  );
}
