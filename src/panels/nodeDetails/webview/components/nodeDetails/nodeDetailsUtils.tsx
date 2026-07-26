import type * as React from "react";
import { ExecutorsIcon, IdleIcon, LaunchIcon, StatusIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

const STALE_AFTER_MS = 5 * 60 * 1000;

export interface OverviewRow {
  label: string;
  value: string;
  icon: React.JSX.Element;
}

export function buildOverviewRows(state: NodeDetailsState): OverviewRow[] {
  const rows: OverviewRow[] = [
    { label: "Status", value: state.statusLabel, icon: <StatusIcon className="h-3.5 w-3.5" /> },
    { label: "Idle", value: state.idleLabel, icon: <IdleIcon className="h-3.5 w-3.5" /> },
    {
      label: "Executors",
      value: state.executorsLabel,
      icon: <ExecutorsIcon className="h-3.5 w-3.5" />
    }
  ];

  const launchDetails = [
    { label: "JNLP Agent", value: state.jnlpAgentLabel },
    { label: "Launch Supported", value: state.launchSupportedLabel },
    { label: "Manual Launch", value: state.manualLaunchLabel }
  ];
  let hasLaunchDetails = false;

  for (const detail of launchDetails) {
    if (!detail.value) {
      continue;
    }

    hasLaunchDetails = true;
    rows.push({
      label: detail.label,
      value: detail.value,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }

  if (!hasLaunchDetails) {
    rows.push({
      label: "Launch",
      value: "Not available",
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }

  return rows;
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value ?? "");
  }
}

export function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export { formatRelativeDate as formatRelativeTime } from "../../../../../formatters/RelativeTimeFormatters";
export function isStaleUpdatedAt(date: Date | undefined, now: number): boolean {
  if (!date) {
    return false;
  }
  return now - date.getTime() > STALE_AFTER_MS;
}
