import { areTreeViewSummariesEqual } from "./TreeDataProviderUtils";
import type { TreeViewSummary } from "./TreeDataProviderTypes";

type TreeSummaryTotals = {
  running: number;
  queue: number;
  hasData: boolean;
};

export class TreeDataProviderSummaryState {
  private watchErrorCount = 0;
  private lastSummary: TreeViewSummary | undefined;

  setWatchErrorCount(count: number): boolean {
    const next = Math.max(0, Math.floor(count));
    if (next === this.watchErrorCount) {
      return false;
    }
    this.watchErrorCount = next;
    return true;
  }

  emitSummary(
    totals: TreeSummaryTotals,
    emit: (summary: TreeViewSummary) => void
  ): void {
    const nextSummary: TreeViewSummary = {
      running: totals.running,
      queue: totals.queue,
      watchErrors: this.watchErrorCount,
      hasData: totals.hasData || this.watchErrorCount > 0
    };

    if (this.lastSummary && areTreeViewSummariesEqual(this.lastSummary, nextSummary)) {
      return;
    }

    this.lastSummary = nextSummary;
    emit(nextSummary);
  }
}

