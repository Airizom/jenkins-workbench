import type * as vscode from "vscode";
import type { CurrentBranchRefreshOptions } from "./CurrentBranchTypes";

const EVENT_REFRESH_DEBOUNCE_MS = 300;

export class CurrentBranchRefreshCoordinator implements vscode.Disposable {
  private refreshHandle: ReturnType<typeof setTimeout> | undefined;
  private pendingScheduledForceRefresh = false;

  dispose(): void {
    this.clearScheduledRefresh();
  }

  beginRefresh(): void {
    this.clearScheduledRefresh();
    this.pendingScheduledForceRefresh = false;
  }

  scheduleRefresh(
    options: CurrentBranchRefreshOptions,
    runRefresh: (options: CurrentBranchRefreshOptions) => void
  ): void {
    if (options.force) {
      this.pendingScheduledForceRefresh = true;
    }

    this.clearScheduledRefresh();
    this.refreshHandle = setTimeout(() => {
      this.refreshHandle = undefined;
      const force = this.pendingScheduledForceRefresh;
      this.pendingScheduledForceRefresh = false;
      runRefresh({ force });
    }, EVENT_REFRESH_DEBOUNCE_MS);
  }

  private clearScheduledRefresh(): void {
    if (!this.refreshHandle) {
      return;
    }
    clearTimeout(this.refreshHandle);
    this.refreshHandle = undefined;
  }
}
