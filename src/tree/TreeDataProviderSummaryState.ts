import type { EnvironmentSummaryTotals } from "./EnvironmentSummaryStore";
import type { TreeViewSummary } from "./TreeDataProviderTypes";

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

  emitSummary(totals: EnvironmentSummaryTotals, emit: (summary: TreeViewSummary) => void): void {
    const { running, queue } = totals;
    const hasData = totals.hasData || this.watchErrorCount > 0;
    const previous = this.lastSummary;
    if (
      previous &&
      previous.running === running &&
      previous.queue === queue &&
      previous.watchErrors === this.watchErrorCount &&
      previous.hasData === hasData
    ) {
      return;
    }

    const nextSummary: TreeViewSummary = {
      running,
      queue,
      watchErrors: this.watchErrorCount,
      hasData
    };
    this.lastSummary = nextSummary;
    emit(nextSummary);
  }
}
