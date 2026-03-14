import { ExecutorsIcon, IdleIcon, LaunchIcon, StatusIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

export const STALE_AFTER_MS = 5 * 60 * 1000;

export interface OverviewRow {
  label: string;
  value: string;
  icon: JSX.Element;
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

  if (state.jnlpAgentLabel) {
    rows.push({
      label: "JNLP Agent",
      value: state.jnlpAgentLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }
  if (state.launchSupportedLabel) {
    rows.push({
      label: "Launch Supported",
      value: state.launchSupportedLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }
  if (state.manualLaunchLabel) {
    rows.push({
      label: "Manual Launch",
      value: state.manualLaunchLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    });
  }

  if (!state.jnlpAgentLabel && !state.launchSupportedLabel && !state.manualLaunchLabel) {
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

export function formatRelativeTime(date: Date | undefined, now: number): string {
  if (!date) {
    return "Unknown";
  }
  const deltaMs = Math.abs(now - date.getTime());
  if (deltaMs < 15_000) {
    return "Just now";
  }
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function isStaleUpdatedAt(date: Date | undefined, now: number): boolean {
  if (!date) {
    return false;
  }
  return now - date.getTime() > STALE_AFTER_MS;
}
