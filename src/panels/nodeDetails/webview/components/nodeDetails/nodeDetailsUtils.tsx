import type * as React from "react";
import {
  ExecutorsIcon,
  LaunchIcon,
  PlayIcon,
  StatusIcon,
  TerminalIcon,
  UserIcon
} from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

const STALE_AFTER_MS = 5 * 60 * 1000;

export interface OverviewRow {
  label: string;
  value: string;
  icon: React.JSX.Element;
}

/** Primary status facts shown first in the Overview Status card. */
export function buildStatusRows(state: NodeDetailsState): OverviewRow[] {
  return [
    { label: "Status", value: state.statusLabel, icon: <StatusIcon className="h-3.5 w-3.5" /> },
    {
      label: "Executors",
      value: state.executorsLabel,
      icon: <ExecutorsIcon className="h-3.5 w-3.5" />
    },
    {
      label: "Activity",
      value: state.activityLabel,
      icon: <PlayIcon className="h-3.5 w-3.5" />
    }
  ];
}

/** Raw Jenkins launch fields, shown as a secondary Connection row when reported. */
export function buildConnectionRows(state: NodeDetailsState): OverviewRow[] {
  const rows: Array<{ label: string; value?: string; icon: React.JSX.Element }> = [
    {
      label: "Inbound (JNLP) agent",
      value: state.jnlpAgentLabel,
      icon: <TerminalIcon className="h-3 w-3" />
    },
    {
      label: "Launch supported",
      value: state.launchSupportedLabel,
      icon: <LaunchIcon className="h-3 w-3" />
    },
    {
      label: "Manual launch",
      value: state.manualLaunchLabel,
      icon: <UserIcon className="h-3 w-3" />
    }
  ];
  return rows.filter((row): row is OverviewRow => row.value !== undefined);
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
