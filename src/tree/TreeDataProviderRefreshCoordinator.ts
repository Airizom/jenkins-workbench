import type { WorkbenchTreeElement } from "./TreeItems";

export type TreeRefreshWaiter = {
  token: number;
  promise: Promise<void>;
  dispose: () => void;
};

export type RefreshCoordinatorNotify = (element?: WorkbenchTreeElement) => void;

export type RefreshCooldownHandler = (durationMs: number) => void;

export class TreeDataProviderRefreshCoordinator {
  private debounceTimer: NodeJS.Timeout | undefined;
  private pendingRefreshElement: WorkbenchTreeElement | undefined | null = null;
  private lastManualRefreshAt = 0;
  private refreshWaiterToken = 0;
  private readonly refreshWaiters = new Map<number, () => void>();
  private readonly pendingRefreshWaiters = new Set<number>();

  constructor(
    private readonly notifyTreeChange: RefreshCoordinatorNotify,
    private readonly onRefreshCooldown: RefreshCooldownHandler
  ) {}

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.refreshWaiters.clear();
    this.pendingRefreshWaiters.clear();
  }

  createRefreshWaiter(): TreeRefreshWaiter {
    this.refreshWaiterToken += 1;
    const token = this.refreshWaiterToken;
    let resolve: (() => void) | undefined;

    const promise = new Promise<void>((resolveFn) => {
      resolve = resolveFn;
    });

    this.refreshWaiters.set(token, () => {
      resolve?.();
      resolve = undefined;
    });

    return {
      token,
      promise,
      dispose: () => {
        this.resolveRefreshWaiter(token);
      }
    };
  }

  refresh(refreshToken: number | undefined, manualCooldownMs: number): boolean {
    const now = Date.now();
    if (now - this.lastManualRefreshAt < manualCooldownMs) {
      this.onRefreshCooldown(manualCooldownMs);
      return false;
    }

    this.lastManualRefreshAt = now;
    this.registerPendingRefreshWaiter(refreshToken);
    this.notifyTreeChange(undefined);
    return true;
  }

  scheduleRefresh(
    element: WorkbenchTreeElement | undefined,
    refreshToken: number | undefined,
    debounceMs: number,
    invalidateForElement: (element: WorkbenchTreeElement) => void
  ): void {
    if (element !== undefined) {
      invalidateForElement(element);
    }

    if (this.pendingRefreshElement === undefined && element !== undefined) {
      this.pendingRefreshElement = element;
    } else {
      this.pendingRefreshElement = undefined;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.registerPendingRefreshWaiter(refreshToken);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const elementToRefresh = this.pendingRefreshElement;
      this.pendingRefreshElement = null;
      this.notifyTreeChange(elementToRefresh === null ? undefined : elementToRefresh);
    }, debounceMs);
  }

  resolveRefreshWaiter(refreshToken: number | undefined): void {
    if (typeof refreshToken !== "number") {
      return;
    }

    const waiter = this.refreshWaiters.get(refreshToken);
    if (!waiter) {
      return;
    }

    this.refreshWaiters.delete(refreshToken);
    this.pendingRefreshWaiters.delete(refreshToken);
    waiter();
  }

  resolvePendingRefreshWaiters(): void {
    if (this.pendingRefreshWaiters.size === 0) {
      return;
    }

    const tokens = Array.from(this.pendingRefreshWaiters);
    this.pendingRefreshWaiters.clear();

    for (const token of tokens) {
      this.resolveRefreshWaiter(token);
    }
  }

  private registerPendingRefreshWaiter(refreshToken: number | undefined): void {
    if (typeof refreshToken === "number") {
      this.pendingRefreshWaiters.add(refreshToken);
    }
  }
}
