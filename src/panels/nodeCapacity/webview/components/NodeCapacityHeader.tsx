import type * as React from "react";
import { PanelHeader } from "../../../shared/webview/components/PanelHeader";
import { Badge } from "../../../shared/webview/components/ui/badge";
import { Button } from "../../../shared/webview/components/ui/button";
import { AccessibleTooltip } from "../../../shared/webview/components/ui/tooltip";
import { AlertTriangleIcon, RefreshIcon, ServerIcon } from "../../../shared/webview/icons";
import { cn } from "../../../shared/webview/lib/utils";

function StaleSnapshotBadge(): React.JSX.Element {
  return (
    <AccessibleTooltip
      focusable
      content="This snapshot is older than the refresh interval. Refresh for current capacity."
    >
      <Badge variant="warning" size="sm">
        <AlertTriangleIcon className="h-3 w-3" aria-hidden="true" />
        Stale
      </Badge>
    </AccessibleTooltip>
  );
}

function UpdatedAtMeta({
  updatedAtLabel,
  updatedAtAbsolute
}: {
  updatedAtLabel: string;
  updatedAtAbsolute: string;
}): React.JSX.Element {
  return (
    <span title={updatedAtAbsolute}>
      Updated {updatedAtLabel}
      <span className="sr-only"> ({updatedAtAbsolute})</span>
    </span>
  );
}

export function NodeCapacityHeader({
  environmentLabel,
  loading,
  loadFailed,
  isStale,
  updatedAtLabel,
  updatedAtAbsolute,
  onRefresh
}: {
  environmentLabel: string;
  loading: boolean;
  loadFailed: boolean;
  isStale: boolean;
  updatedAtLabel: string;
  updatedAtAbsolute: string;
  onRefresh: () => void;
}): React.JSX.Element {
  return (
    <PanelHeader
      eyebrow={environmentLabel}
      eyebrowIcon={<ServerIcon className="h-3.5 w-3.5" />}
      title="Node Capacity"
      titleAdornment={isStale && !loadFailed ? <StaleSnapshotBadge /> : null}
      meta={
        loadFailed ? undefined : (
          <UpdatedAtMeta updatedAtLabel={updatedAtLabel} updatedAtAbsolute={updatedAtAbsolute} />
        )
      }
      actions={
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshIcon className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    />
  );
}
