import type * as React from "react";
import { formatRelativeTimestampMs } from "../../../../../formatters/RelativeTimeFormatters";
import { LaunchIcon, TerminalIcon, UserIcon } from "../../../../shared/webview/icons";
import type { NodeDetailsState } from "../../state/nodeDetailsState";

const STALE_AFTER_MS = 5 * 60 * 1000;

export interface OverviewRow {
  label: string;
  value: string;
  icon: React.JSX.Element;
}

/**
 * "3h ago" for the offline banner, with the full timestamp for its tooltip.
 * Undefined when Jenkins did not record when the node went offline.
 */
export function formatOfflineSince(
  offlineSinceMs: number | undefined
): { label: string; title: string } | undefined {
  if (offlineSinceMs === undefined) {
    return undefined;
  }
  const label = formatRelativeTimestampMs(offlineSinceMs);
  return label === undefined
    ? undefined
    : { label, title: new Date(offlineSinceMs).toLocaleString() };
}

/** Raw Jenkins launch fields for the Overview Connection card, when reported. */
export function buildConnectionRows(
  state: Pick<NodeDetailsState, "jnlpAgentLabel" | "launchSupportedLabel" | "manualLaunchLabel">
): OverviewRow[] {
  const rows: Array<{ label: string; value?: string; icon: React.JSX.Element }> = [
    {
      label: "Inbound (JNLP) agent",
      value: state.jnlpAgentLabel,
      icon: <TerminalIcon className="h-3.5 w-3.5" />
    },
    {
      label: "Launch supported",
      value: state.launchSupportedLabel,
      icon: <LaunchIcon className="h-3.5 w-3.5" />
    },
    {
      label: "Manual launch",
      value: state.manualLaunchLabel,
      icon: <UserIcon className="h-3.5 w-3.5" />
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
