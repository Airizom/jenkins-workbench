import type * as React from "react";
import { formatRelativeTimestampMs } from "../../../../../formatters/RelativeTimeFormatters";
import {
  ClockIcon,
  ExecutorsIcon,
  LaunchIcon,
  PlayIcon,
  TerminalIcon,
  UserIcon
} from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

const STALE_AFTER_MS = 5 * 60 * 1000;

export interface OverviewRow {
  label: string;
  value: string;
  /** Full value for the native tooltip when `value` is abbreviated. */
  title?: string;
  icon: React.JSX.Element;
}

type StatusRowState = Pick<
  NodeDetailsState,
  "statusLabel" | "executorsLabel" | "activityLabel" | "isOffline" | "offlineSinceMs"
>;

/**
 * Status facts for the Overview Status card. The hero badge and offline banner
 * already state the status and reason, so this card adds what they do not:
 * executor usage, what the node is doing, and how long it has been offline.
 */
export function buildStatusRows(state: StatusRowState): OverviewRow[] {
  const rows: OverviewRow[] = [
    {
      label: "Executors",
      value: state.executorsLabel,
      icon: <ExecutorsIcon className="h-3.5 w-3.5" />
    }
  ];
  if (state.isOffline) {
    const offlineSince =
      state.offlineSinceMs === undefined
        ? undefined
        : formatRelativeTimestampMs(state.offlineSinceMs);
    if (offlineSince !== undefined && state.offlineSinceMs !== undefined) {
      rows.push({
        label: "Offline since",
        value: offlineSince,
        title: new Date(state.offlineSinceMs).toLocaleString(),
        icon: <ClockIcon className="h-3.5 w-3.5" />
      });
    }
  } else if (state.activityLabel !== state.statusLabel) {
    rows.push({
      label: "Activity",
      value: state.activityLabel,
      icon: <PlayIcon className="h-3.5 w-3.5" />
    });
  }
  return rows;
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

export { formatUpdatedAtLabel } from "../../../../../formatters/RelativeTimeFormatters";
export function isStaleUpdatedAt(date: Date | undefined, now: number): boolean {
  if (!date) {
    return false;
  }
  return now - date.getTime() > STALE_AFTER_MS;
}
