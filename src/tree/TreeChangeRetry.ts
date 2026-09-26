import type * as vscode from "vscode";
import type { WorkbenchTreeElement } from "./items/WorkbenchTreeElement";
import { areWorkbenchTreeElementsEquivalent } from "./TreeDataProviderUtils";

const TREE_CHANGE_RETRY_LIMIT = 3;
const TREE_CHANGE_RETRY_TIMEOUT_MS = 4000;

export type TreeChangeRetryOptions<Result> = {
  operation: () => Promise<Result>;
  onDidChangeTreeData: vscode.Event<WorkbenchTreeElement | undefined>;
  shouldRetry: (result: Result) => boolean;
  getPendingElement: (result: Result) => WorkbenchTreeElement | undefined;
  getPendingElementBeforeOperation?: () => WorkbenchTreeElement | undefined;
  retryAfterTimeout?: boolean;
  waitAfterRetryExhausted?: boolean;
  retryLimit?: number;
  timeoutMs?: number;
};

export async function retryOnTreeChange<Result>(
  options: TreeChangeRetryOptions<Result>
): Promise<Result> {
  const retryLimit = options.retryLimit ?? TREE_CHANGE_RETRY_LIMIT;
  for (let attempt = 0; ; attempt += 1) {
    const canRetry = attempt < retryLimit;
    const { result, didChange } = await runTreeChangeAttempt(
      options,
      canRetry || options.waitAfterRetryExhausted === true
    );
    if (!options.shouldRetry(result) || !canRetry) {
      return result;
    }
    if (!didChange && options.retryAfterTimeout !== true) {
      return result;
    }
  }
}

async function runTreeChangeAttempt<Result>(
  options: TreeChangeRetryOptions<Result>,
  shouldWait: boolean
): Promise<{ result: Result; didChange: boolean }> {
  const observedChanges: Array<WorkbenchTreeElement | undefined> = [];
  let pendingElement: WorkbenchTreeElement | undefined;
  let waiting = false;
  let acceptingChanges = true;
  let settleChange: ((didChange: boolean) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: vscode.Disposable | undefined;
  const finishWaiting = (didChange: boolean) => {
    if (!settleChange) {
      return;
    }
    const settle = settleChange;
    settleChange = undefined;
    acceptingChanges = false;
    subscription?.dispose();
    subscription = undefined;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    settle(didChange);
  };
  subscription = options.onDidChangeTreeData((changedElement) => {
    if (!acceptingChanges) {
      return;
    }
    // Record every change so the resolved pending element can be checked after the
    // operation, even when an early wait targets a different provisional element.
    observedChanges.push(changedElement);
    if (waiting && doesTreeChangeMatch(changedElement, pendingElement)) {
      finishWaiting(true);
    }
  });
  const startWaiting = () =>
    new Promise<boolean>((resolve) => {
      settleChange = resolve;
      waiting = true;
      timer = setTimeout(
        () => finishWaiting(false),
        options.timeoutMs ?? TREE_CHANGE_RETRY_TIMEOUT_MS
      );
    });
  const earlyWait = options.getPendingElementBeforeOperation
    ? (() => {
        pendingElement = options.getPendingElementBeforeOperation?.();
        return startWaiting();
      })()
    : undefined;

  try {
    const result = await options.operation();
    if (!options.shouldRetry(result)) {
      return { result, didChange: false };
    }
    pendingElement = options.getPendingElement(result);
    if (
      observedChanges.some((changedElement) => doesTreeChangeMatch(changedElement, pendingElement))
    ) {
      return { result, didChange: true };
    }
    if (!shouldWait) {
      return { result, didChange: false };
    }
    if (earlyWait) {
      return { result, didChange: await earlyWait };
    }

    const didChange = await startWaiting();
    return { result, didChange };
  } finally {
    finishWaiting(false);
    subscription?.dispose();
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function doesTreeChangeMatch(
  changedElement: WorkbenchTreeElement | undefined,
  pendingElement: WorkbenchTreeElement | undefined
): boolean {
  return (
    changedElement === undefined ||
    areWorkbenchTreeElementsEquivalent(changedElement, pendingElement)
  );
}
