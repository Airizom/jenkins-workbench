import * as vscode from "vscode";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileEnvironmentResolver } from "./JenkinsfileEnvironmentResolver";
import type { JenkinsfileMatcher } from "./JenkinsfileMatcher";
import type {
  ValidationOutcome,
  ValidationReason,
  ValidationRequestOptions
} from "./JenkinsfileValidationCoordinatorTypes";
import {
  buildNoEnvironmentDiagnostic,
  buildRequestFailedDiagnostic,
  buildValidationDiagnostics
} from "./JenkinsfileValidationDiagnostics";
import { JenkinsfileValidationOutputLogger } from "./JenkinsfileValidationOutputLogger";
import { JenkinsfileValidationRunner } from "./JenkinsfileValidationRunner";
import { JenkinsfileValidationStateStore } from "./JenkinsfileValidationStateStore";
import type { JenkinsfileValidationStatusBar } from "./JenkinsfileValidationStatusBar";
import type {
  JenkinsfileValidationStatusProvider,
  JenkinsfileValidationStatusState
} from "./JenkinsfileValidationStatusProvider";
import type { JenkinsfileValidationConfig } from "./JenkinsfileValidationTypes";

export class JenkinsfileValidationCoordinator
  implements vscode.Disposable, JenkinsfileValidationStatusProvider
{
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("Jenkinsfile");
  private readonly outputChannel = vscode.window.createOutputChannel("Jenkinsfile Validation");
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly statusEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly stateStore = new JenkinsfileValidationStateStore();
  private readonly logger = new JenkinsfileValidationOutputLogger(this.outputChannel);
  private readonly runner: JenkinsfileValidationRunner;
  private config: JenkinsfileValidationConfig;

  constructor(
    clientProvider: JenkinsClientProvider,
    environmentResolver: JenkinsfileEnvironmentResolver,
    private readonly statusBar: JenkinsfileValidationStatusBar,
    private readonly matcher: JenkinsfileMatcher,
    config: JenkinsfileValidationConfig
  ) {
    this.config = config;
    this.runner = new JenkinsfileValidationRunner(
      clientProvider,
      environmentResolver,
      this.stateStore,
      this.logger
    );
  }

  readonly onDidChangeValidationStatus = this.statusEmitter.event;

  start(): void {
    this.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!this.shouldRunAutomaticValidation()) {
          return;
        }
        if (!this.matcher.matches(document)) {
          return;
        }
        this.cancelChangeValidation(document);
        void this.validateDocument(document, { reason: "save" });
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (!this.shouldRunAutomaticValidation()) {
          return;
        }
        if (!this.matcher.matches(document)) {
          return;
        }
        void this.validateDocument(document, { reason: "open" });
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.config.enabled) {
          return;
        }
        if (event.contentChanges.length === 0) {
          return;
        }
        const document = event.document;
        if (!this.matcher.matches(document)) {
          return;
        }
        this.setResultStaleState(document, true);
        if (!this.config.runOnSave) {
          return;
        }
        this.scheduleChangeValidation(document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.clearDocumentState(document);
      })
    );
  }

  updateConfig(config: JenkinsfileValidationConfig): void {
    const patternsChanged = !arePatternsEqual(this.config.filePatterns, config.filePatterns);
    this.config = config;
    if (patternsChanged) {
      this.matcher.updatePatterns(config.filePatterns);
      this.handleMatcherUpdate();
    }
    if (!config.enabled) {
      this.clearDiagnostics();
    }
  }

  revalidateActiveDocument(reason: ValidationReason = "command"): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    this.revalidateDocument(editor.document, reason);
  }

  revalidateDocument(document: vscode.TextDocument, reason: ValidationReason = "command"): void {
    if (!this.config.enabled || document.isClosed) {
      return;
    }
    if (!this.matcher.matches(document)) {
      return;
    }
    this.cancelChangeValidation(document);
    void this.validateDocument(document, { reason, force: true });
  }

  handleMatcherUpdate(): void {
    const shouldRevalidate = this.config.enabled;
    for (const document of vscode.workspace.textDocuments) {
      if (!this.matcher.matches(document)) {
        this.clearDocumentState(document);
        continue;
      }
      if (shouldRevalidate) {
        this.revalidateDocument(document, "change");
      }
    }
    this.statusBar.refreshActiveDocument();
  }

  getLastValidationEnvironment(
    document: vscode.TextDocument
  ): JenkinsEnvironmentRef | null | undefined {
    return this.stateStore.getLastValidationEnvironment(document);
  }

  getValidationState(document: vscode.TextDocument): JenkinsfileValidationStatusState | undefined {
    return this.stateStore.getValidationState(document);
  }

  async validateActiveEditor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("Open a Jenkinsfile to validate.");
      return;
    }
    const document = editor.document;
    if (!this.matcher.matches(document)) {
      void vscode.window.showInformationMessage("Active editor is not a Jenkinsfile.");
      return;
    }
    if (!this.config.enabled) {
      void vscode.window.showInformationMessage("Jenkinsfile validation is disabled in settings.");
      return;
    }
    this.cancelChangeValidation(document);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Validating Jenkinsfile...",
        cancellable: true
      },
      async (_progress, token) => {
        const outcome = await this.validateDocument(document, {
          reason: "command",
          force: true,
          cancellationToken: token
        });
        if (token.isCancellationRequested) {
          return;
        }
        this.showOutputChannel();
        if (outcome.status === "completed" && outcome.kind === "request-failed") {
          void vscode.window.showWarningMessage(outcome.message);
          return;
        }
        if (
          outcome.status !== "completed" ||
          outcome.kind !== "result" ||
          outcome.errorCount === 0
        ) {
          return;
        }
        const count = outcome.errorCount;
        const label = count === 1 ? "problem" : "problems";
        const selection = await vscode.window.showWarningMessage(
          `Jenkinsfile validation found ${count} ${label}.`,
          "Show Problems"
        );
        if (selection === "Show Problems") {
          void vscode.commands.executeCommand("workbench.action.problems.focus");
        }
      }
    );
  }

  clearDiagnostics(): void {
    const documents = this.stateStore.clearAll();
    this.diagnostics.clear();
    this.statusBar.clearAll();
    for (const uri of documents) {
      this.statusEmitter.fire(uri);
    }
  }

  clearWorkspaceState(workspaceFolder: vscode.WorkspaceFolder): void {
    const workspaceKey = workspaceFolder.uri.toString();
    for (const document of vscode.workspace.textDocuments) {
      if (!this.matcher.matches(document)) {
        continue;
      }
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!folder || folder.uri.toString() !== workspaceKey) {
        continue;
      }
      this.clearDocumentState(document);
    }
  }

  clearFallbackState(): void {
    for (const document of vscode.workspace.textDocuments) {
      if (!this.matcher.matches(document)) {
        continue;
      }
      if (vscode.workspace.getWorkspaceFolder(document.uri)) {
        continue;
      }
      this.clearDocumentState(document);
    }
  }

  revalidateWorkspaceState(workspaceFolder: vscode.WorkspaceFolder): void {
    this.revalidateMatchingDocuments((documentFolder) => {
      return documentFolder?.uri.toString() === workspaceFolder.uri.toString();
    });
  }

  revalidateFallbackState(): void {
    this.revalidateMatchingDocuments((documentFolder) => !documentFolder);
  }

  dispose(): void {
    this.diagnostics.dispose();
    this.outputChannel.dispose();
    this.stateStore.clearAll();
    this.statusEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private async validateDocument(
    document: vscode.TextDocument,
    options: ValidationRequestOptions
  ): Promise<ValidationOutcome> {
    if (!this.matcher.matches(document)) {
      this.diagnostics.delete(document.uri);
      this.statusBar.clear(document);
      return { status: "skipped" };
    }

    const outcome = await this.runner.run(document, options, {
      onValidationStart: () => {
        this.statusBar.setValidating(document);
      },
      onEnvironmentResolved: (environment) => {
        this.statusBar.setValidating(document, environment);
      },
      onRestoreStatus: () => {
        this.restoreStatusBar(document);
      }
    });

    if (outcome.status === "skipped" && outcome.reason === "cached") {
      this.setResultStaleState(document, false);
      this.restoreStatusBar(document);
      return outcome;
    }

    if (outcome.status !== "completed") {
      return outcome;
    }

    if (outcome.kind === "no-environment") {
      const diagnostic = buildNoEnvironmentDiagnostic(document);
      this.diagnostics.set(document.uri, [diagnostic]);
      this.setNoEnvironmentState(document);
      return outcome;
    }

    if (outcome.kind === "request-failed") {
      const diagnostic = buildRequestFailedDiagnostic(document, outcome.message);
      this.diagnostics.set(document.uri, [diagnostic]);
      this.stateStore.clearCachedValidation(document);
      this.setRequestFailedState(document, outcome.message, outcome.environment);
      return outcome;
    }

    const diagnostics = buildValidationDiagnostics(document, outcome.findings);
    if (document.isClosed) {
      return { status: "skipped", reason: "closed" };
    }
    if (diagnostics.length === 0) {
      this.diagnostics.delete(document.uri);
    } else {
      this.diagnostics.set(document.uri, diagnostics);
    }

    this.setResultState(document, outcome.errorCount, outcome.environment);
    this.stateStore.updateCachedValidation(document, {
      hash: outcome.hash,
      environmentKey: outcome.environmentKey
    });
    return outcome;
  }

  showOutputChannel(): void {
    this.logger.show();
  }

  private setResultState(
    document: vscode.TextDocument,
    errorCount: number,
    environment?: JenkinsEnvironmentRef,
    stale = false
  ): void {
    const { changed, state } = this.stateStore.setResultState(
      document,
      errorCount,
      environment,
      stale
    );
    this.statusBar.setResult(document, state.errorCount, state.environment, Boolean(state.stale));
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private setResultStaleState(document: vscode.TextDocument, stale: boolean): void {
    const { changed, state } = this.stateStore.setResultStaleState(document, stale);
    if (!state) {
      return;
    }
    this.statusBar.setResult(document, state.errorCount, state.environment, Boolean(state.stale));
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private setNoEnvironmentState(document: vscode.TextDocument): void {
    const changed = this.stateStore.setNoEnvironmentState(document);
    this.statusBar.setNoEnvironment(document);
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private setRequestFailedState(
    document: vscode.TextDocument,
    message: string,
    environment?: JenkinsEnvironmentRef
  ): void {
    const { changed, state } = this.stateStore.setRequestFailedState(
      document,
      message,
      environment
    );
    this.statusBar.setRequestFailed(document, state.message, state.environment);
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private scheduleChangeValidation(document: vscode.TextDocument): void {
    if (!this.config.enabled) {
      return;
    }
    this.stateStore.scheduleChangeValidation(
      document,
      this.config.changeDebounceMs,
      (nextDocument) => {
        this.triggerChangeValidation(nextDocument);
      }
    );
  }

  private triggerChangeValidation(document: vscode.TextDocument): void {
    if (!this.config.enabled || document.isClosed) {
      return;
    }
    const { key, tokenSource } = this.stateStore.beginChangeValidation(document);
    void this.validateDocument(document, {
      reason: "change",
      cancellationToken: tokenSource.token
    }).finally(() => {
      this.stateStore.completeChangeValidation(key, tokenSource);
      tokenSource.dispose();
    });
  }

  private cancelChangeValidation(document: vscode.TextDocument): void {
    this.stateStore.cancelChangeValidation(document);
  }

  private clearDocumentState(document: vscode.TextDocument): void {
    const changed = this.stateStore.clearDocumentState(document);
    this.diagnostics.delete(document.uri);
    this.statusBar.clear(document);
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private restoreStatusBar(document: vscode.TextDocument): void {
    const lastState = this.stateStore.getStatusState(document);
    if (lastState?.kind === "result") {
      this.statusBar.setResult(
        document,
        lastState.errorCount,
        lastState.environment,
        Boolean(lastState.stale)
      );
      return;
    }
    if (lastState?.kind === "no-environment") {
      this.statusBar.setNoEnvironment(document);
      return;
    }
    if (lastState?.kind === "request-failed") {
      this.statusBar.setRequestFailed(document, lastState.message, lastState.environment);
      return;
    }
    this.statusBar.clear(document);
  }

  private revalidateMatchingDocuments(
    predicate: (workspaceFolder: vscode.WorkspaceFolder | undefined) => boolean
  ): void {
    for (const document of vscode.workspace.textDocuments) {
      if (!this.matcher.matches(document) || document.isClosed) {
        continue;
      }
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!predicate(workspaceFolder)) {
        continue;
      }
      this.revalidateDocument(document);
    }
  }

  private emitStatusChangeIfNeeded(document: vscode.TextDocument, changed: boolean): void {
    if (!changed) {
      return;
    }
    this.statusEmitter.fire(document.uri);
  }

  private shouldRunAutomaticValidation(): boolean {
    return this.config.enabled && this.config.runOnSave;
  }
}

function arePatternsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
