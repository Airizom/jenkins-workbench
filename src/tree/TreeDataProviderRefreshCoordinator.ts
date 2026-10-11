import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";

export type TreeRefreshWaiter = {
  token: number;
  promise: Promise<void>;
  dispose: () => void;
};

export type RefreshCoordinatorNotify = (element?: WorkbenchTreeElement) => void;

export type RefreshCooldownHandler = (durationMs: number) => void;

export class TreeDataProviderRefreshCoordinator {
  private debounceTimer: NodeJS.Timeout | undefined;
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
    for (const resolveWaiter of this.refreshWaiters.values()) {
      resolveWaiter();
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
    if (!this.beginManualRefresh(refreshToken, manualCooldownMs)) {
      return false;
    }

    this.notifyTreeChange(undefined);
    return true;
  }

  beginManualRefresh(refreshToken: number | undefined, manualCooldownMs: number): boolean {
    const now = Date.now();
    if (now - this.lastManualRefreshAt < manualCooldownMs) {
      this.onRefreshCooldown(manualCooldownMs);
      return false;
    }

    this.lastManualRefreshAt = now;
    this.registerPendingRefreshWaiter(refreshToken);
    return true;
  }

  scheduleRefresh(refreshToken: number | undefined, debounceMs: number): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.registerPendingRefreshWaiter(refreshToken);

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.notifyTreeChange(undefined);
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

  takePendingRefreshWaiters(): number[] {
    const tokens = Array.from(this.pendingRefreshWaiters);
    this.pendingRefreshWaiters.clear();
    return tokens;
  }

  private registerPendingRefreshWaiter(refreshToken: number | undefined): void {
    if (typeof refreshToken === "number") {
      this.pendingRefreshWaiters.add(refreshToken);
    }
  }
}
