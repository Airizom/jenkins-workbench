import type { JobFilterMode } from "../storage/JenkinsViewStateStore";
import { formatCountLabel } from "./TreeCountLabels";
import type { TreeViewSummary } from "./TreeDataProviderTypes";

export interface TreeViewSummaryPresentation {
  message?: string;
  badge?: { value: number; tooltip: string };
}

// The badge always counts running jobs so its number keeps one meaning. Watch errors are the
// only condition worth a persistent banner at the top of the view.
export function formatTreeViewSummary(summary: TreeViewSummary): TreeViewSummaryPresentation {
  const parts: string[] = [];
  if (summary.running > 0) {
    parts.push(`${summary.running} running`);
  }
  if (summary.queue > 0) {
    parts.push(`${summary.queue} queued`);
  }

  const message =
    summary.watchErrors > 0
      ? `Could not check ${formatCountLabel(summary.watchErrors, "watched job")}. Retrying on the next poll.`
      : undefined;
  const badge =
    summary.running > 0 ? { value: summary.running, tooltip: parts.join(" • ") } : undefined;
  return { message, badge };
}

export function formatJobFilterDescription(mode: JobFilterMode): string | undefined {
  switch (mode) {
    case "failing":
      return "Filter: failing jobs";
    case "running":
      return "Filter: running jobs";
    case "all":
      return undefined;
  }
}
