import type * as vscode from "vscode";

export function disposePanelResources(disposables: vscode.Disposable[]): void {
  while (disposables.length > 0) {
    const disposable = disposables.pop();
    disposable?.dispose();
  }
}

export function disposeRefreshSubscription(subscription?: vscode.Disposable): void {
  subscription?.dispose();
}

export function disposeEnvironmentScopedPanel(options: {
  clearSingleton: () => void;
  disposables: vscode.Disposable[];
  onDispose?: () => void;
  refreshSubscription?: vscode.Disposable;
}): void {
  options.clearSingleton();
  options.onDispose?.();
  disposeRefreshSubscription(options.refreshSubscription);
  disposePanelResources(options.disposables);
}

export function attachPanelLifecycle(
  panel: vscode.WebviewPanel,
  disposables: vscode.Disposable[],
  handlers: {
    onDispose: () => void;
    onVisible: () => void;
  }
): void {
  panel.onDidDispose(handlers.onDispose, null, disposables);
  panel.onDidChangeViewState(
    () => {
      if (panel.visible) {
        handlers.onVisible();
      }
    },
    null,
    disposables
  );
}

export function shouldRefreshEnvironmentScopedPanel(options: {
  environment?: { environmentId: string };
  environmentId?: string;
  hasRendered: boolean;
  requireVisible?: boolean;
  panel?: vscode.WebviewPanel;
}): boolean {
  if (!options.environment || !options.hasRendered) {
    return false;
  }
  if (options.environmentId && options.environment.environmentId !== options.environmentId) {
    return false;
  }
  if (options.requireVisible && options.panel && !options.panel.visible) {
    return false;
  }
  return true;
}

export function bindEnvironmentRefresh(
  current: vscode.Disposable | undefined,
  refreshHost:
    | {
        onDidRefreshEnvironment?: (listener: (environmentId?: string) => void) => vscode.Disposable;
      }
    | undefined,
  refresh: (environmentId?: string) => Promise<void>
): vscode.Disposable | undefined {
  return replaceRefreshSubscription(current, refreshHost, (environmentId) => {
    void refresh(environmentId);
  });
}

export function replaceRefreshSubscription(
  current: vscode.Disposable | undefined,
  refreshHost:
    | {
        onDidRefreshEnvironment?: (listener: (environmentId?: string) => void) => vscode.Disposable;
      }
    | undefined,
  listener: (environmentId?: string) => void
): vscode.Disposable | undefined {
  current?.dispose();
  if (!refreshHost?.onDidRefreshEnvironment) {
    return undefined;
  }
  return refreshHost.onDidRefreshEnvironment(listener);
}

export function beginLoadingRequest(
  loadingRequests: number,
  postLoading: (value: boolean) => void
): number {
  const next = loadingRequests + 1;
  if (next === 1) {
    postLoading(true);
  }
  return next;
}

export function endLoadingRequest(
  loadingRequests: number,
  postLoading: (value: boolean) => void
): number {
  if (loadingRequests === 0) {
    return 0;
  }
  const next = loadingRequests - 1;
  if (next === 0) {
    postLoading(false);
  }
  return next;
}

export class PanelLoadTracker {
  private loadToken = 0;
  private loadingRequests = 0;

  constructor(private readonly postLoading: (value: boolean) => void) {}

  nextToken(): number {
    return ++this.loadToken;
  }

  get currentToken(): number {
    return this.loadToken;
  }

  isCurrent(token: number): boolean {
    return token === this.loadToken;
  }

  resetLoadingRequests(): void {
    this.loadingRequests = 0;
  }

  beginLoading(): void {
    this.loadingRequests = beginLoadingRequest(this.loadingRequests, this.postLoading);
  }

  endLoading(): void {
    this.loadingRequests = endLoadingRequest(this.loadingRequests, this.postLoading);
  }
}
