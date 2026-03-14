import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type {
  ValidationCacheEntry,
  ValidationRequestOptions
} from "./JenkinsfileValidationCoordinatorTypes";
import type { JenkinsfileValidationStatusState } from "./JenkinsfileValidationStatusProvider";

type ResultValidationState = Extract<JenkinsfileValidationStatusState, { kind: "result" }>;
type RequestFailedValidationState = Extract<
  JenkinsfileValidationStatusState,
  { kind: "request-failed" }
>;

export class JenkinsfileValidationStateStore {
  private readonly lastValidatedState = new Map<string, ValidationCacheEntry>();
  private readonly lastStatusState = new Map<string, JenkinsfileValidationStatusState>();
  private readonly activeTokens = new Map<string, number>();
  private readonly pendingChangeTimers = new Map<string, NodeJS.Timeout>();
  private readonly changeTokenSources = new Map<string, vscode.CancellationTokenSource>();
  private tokenCounter = 0;

  getLastValidationEnvironment(
    document: vscode.TextDocument
  ): JenkinsEnvironmentRef | null | undefined {
    const state = this.lastStatusState.get(this.getDocumentKey(document));
    if (!state) {
      return undefined;
    }
    if (state.kind === "no-environment") {
      return null;
    }
    return state.environment;
  }

  getValidationState(document: vscode.TextDocument): JenkinsfileValidationStatusState | undefined {
    const state = this.lastStatusState.get(this.getDocumentKey(document));
    if (!state) {
      return undefined;
    }
    if (state.kind === "no-environment") {
      return { kind: "no-environment" };
    }
    if (state.kind === "request-failed") {
      return {
        kind: "request-failed",
        environment: state.environment,
        message: state.message
      };
    }
    return {
      kind: "result",
      errorCount: state.errorCount,
      environment: state.environment,
      stale: state.stale
    };
  }

  getStatusState(document: vscode.TextDocument): JenkinsfileValidationStatusState | undefined {
    return this.lastStatusState.get(this.getDocumentKey(document));
  }

  setResultState(
    document: vscode.TextDocument,
    errorCount: number,
    environment?: JenkinsEnvironmentRef,
    stale = false
  ): { changed: boolean; state: ResultValidationState } {
    const nextState: ResultValidationState = {
      kind: "result",
      errorCount,
      environment,
      stale
    };
    const changed = this.updateStatusState(document, nextState);
    return { changed, state: nextState };
  }

  setResultStaleState(
    document: vscode.TextDocument,
    stale: boolean
  ): { changed: boolean; state?: ResultValidationState } {
    const lastState = this.getStatusState(document);
    if (!lastState || lastState.kind !== "result") {
      return { changed: false };
    }
    if (Boolean(lastState.stale) === stale) {
      return { changed: false, state: lastState };
    }
    return this.setResultState(document, lastState.errorCount, lastState.environment, stale);
  }

  setNoEnvironmentState(document: vscode.TextDocument): boolean {
    return this.updateStatusState(document, { kind: "no-environment" });
  }

  setRequestFailedState(
    document: vscode.TextDocument,
    message: string,
    environment?: JenkinsEnvironmentRef
  ): { changed: boolean; state: RequestFailedValidationState } {
    const nextState: RequestFailedValidationState = {
      kind: "request-failed",
      environment,
      message
    };
    const changed = this.updateStatusState(document, nextState);
    return { changed, state: nextState };
  }

  clearDocumentState(document: vscode.TextDocument): boolean {
    this.cancelChangeValidation(document);
    const key = this.getDocumentKey(document);
    this.lastValidatedState.delete(key);
    const changed = this.updateStatusState(document, undefined);
    this.activeTokens.delete(key);
    return changed;
  }

  clearAll(): vscode.Uri[] {
    const documents = this.getStatusUris();
    this.lastValidatedState.clear();
    this.lastStatusState.clear();
    this.activeTokens.clear();
    this.cancelAllChangeValidations();
    return documents;
  }

  getCachedValidation(document: vscode.TextDocument): ValidationCacheEntry | undefined {
    return this.lastValidatedState.get(this.getDocumentKey(document));
  }

  updateCachedValidation(document: vscode.TextDocument, entry: ValidationCacheEntry): void {
    this.lastValidatedState.set(this.getDocumentKey(document), entry);
  }

  clearCachedValidation(document: vscode.TextDocument): void {
    this.lastValidatedState.delete(this.getDocumentKey(document));
  }

  canReuseCachedResult(
    options: ValidationRequestOptions,
    cached: ValidationCacheEntry | undefined,
    hash: string,
    environmentKey: string
  ): boolean {
    if (options.force || !cached) {
      return false;
    }

    return cached.hash === hash && cached.environmentKey === environmentKey;
  }

  nextToken(document: vscode.TextDocument): { key: string; token: number } {
    const key = this.getDocumentKey(document);
    const token = this.tokenCounter + 1;
    this.tokenCounter = token;
    this.activeTokens.set(key, token);
    return { key, token };
  }

  isActiveToken(key: string, token: number): boolean {
    return this.activeTokens.get(key) === token;
  }

  scheduleChangeValidation(
    document: vscode.TextDocument,
    debounceMs: number,
    trigger: (document: vscode.TextDocument) => void
  ): void {
    this.cancelChangeValidation(document);
    if (debounceMs === 0) {
      trigger(document);
      return;
    }

    const key = this.getDocumentKey(document);
    const timer = setTimeout(() => {
      this.pendingChangeTimers.delete(key);
      trigger(document);
    }, debounceMs);
    this.pendingChangeTimers.set(key, timer);
  }

  beginChangeValidation(document: vscode.TextDocument): {
    key: string;
    tokenSource: vscode.CancellationTokenSource;
  } {
    const key = this.getDocumentKey(document);
    const tokenSource = new vscode.CancellationTokenSource();
    this.changeTokenSources.set(key, tokenSource);
    return { key, tokenSource };
  }

  completeChangeValidation(key: string, tokenSource: vscode.CancellationTokenSource): void {
    if (this.changeTokenSources.get(key) === tokenSource) {
      this.changeTokenSources.delete(key);
    }
  }

  cancelChangeValidation(document: vscode.TextDocument): void {
    const key = this.getDocumentKey(document);
    const timer = this.pendingChangeTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingChangeTimers.delete(key);
    }
    const tokenSource = this.changeTokenSources.get(key);
    if (tokenSource) {
      tokenSource.cancel();
      tokenSource.dispose();
      this.changeTokenSources.delete(key);
    }
  }

  private cancelAllChangeValidations(): void {
    for (const timer of this.pendingChangeTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingChangeTimers.clear();
    for (const tokenSource of this.changeTokenSources.values()) {
      tokenSource.cancel();
      tokenSource.dispose();
    }
    this.changeTokenSources.clear();
  }

  private updateStatusState(
    document: vscode.TextDocument,
    nextState: JenkinsfileValidationStatusState | undefined
  ): boolean {
    const key = this.getDocumentKey(document);
    const previous = this.lastStatusState.get(key);
    if (nextState) {
      this.lastStatusState.set(key, nextState);
    } else {
      this.lastStatusState.delete(key);
    }
    return !areStatusStatesEqual(previous, nextState);
  }

  private getStatusUris(): vscode.Uri[] {
    return Array.from(this.lastStatusState.keys(), (key) => vscode.Uri.parse(key));
  }

  private getDocumentKey(document: vscode.TextDocument): string {
    return document.uri.toString();
  }
}

function areStatusStatesEqual(
  left: JenkinsfileValidationStatusState | undefined,
  right: JenkinsfileValidationStatusState | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "no-environment" && right.kind === "no-environment") {
    return true;
  }
  if (left.kind === "request-failed" && right.kind === "request-failed") {
    return (
      left.message === right.message &&
      getEnvironmentSignature(left.environment) === getEnvironmentSignature(right.environment)
    );
  }
  if (left.kind !== "result" || right.kind !== "result") {
    return false;
  }
  return (
    left.errorCount === right.errorCount &&
    Boolean(left.stale) === Boolean(right.stale) &&
    getEnvironmentSignature(left.environment) === getEnvironmentSignature(right.environment)
  );
}

function getEnvironmentSignature(environment?: JenkinsEnvironmentRef): string | undefined {
  if (!environment) {
    return undefined;
  }
  return [
    environment.environmentId,
    environment.scope,
    environment.url,
    environment.username ?? ""
  ].join("|");
}
