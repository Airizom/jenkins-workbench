import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { formatError } from "../formatters/ErrorFormatters";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { setDiagnosticMetadata } from "./JenkinsfileDiagnosticMetadata";
import { JENKINS_DIAGNOSTIC_SOURCE } from "./JenkinsfileDiagnosticUtils";
import type { JenkinsfileEnvironmentResolver } from "./JenkinsfileEnvironmentResolver";
import type { JenkinsfileMatcher } from "./JenkinsfileMatcher";
import { parseDeclarativeValidationOutput } from "./JenkinsfileValidationParser";
import type { JenkinsfileValidationStatusBar } from "./JenkinsfileValidationStatusBar";
import type {
  JenkinsfileValidationStatusProvider,
  JenkinsfileValidationStatusState
} from "./JenkinsfileValidationStatusProvider";
import type {
  JenkinsfileValidationConfig,
  JenkinsfileValidationFinding
} from "./JenkinsfileValidationTypes";
import { findTokenOccurrence, isTokenChar } from "./JenkinsfileValidationUtils";

type ValidationReason = "save" | "command" | "change" | "open";

interface ValidationRequestOptions {
  reason: ValidationReason;
  force?: boolean;
  cancellationToken?: vscode.CancellationToken;
}

interface ValidationCacheEntry {
  hash: string;
  environmentKey: string;
}

type ValidationOutcome =
  | { status: "skipped" }
  | { status: "canceled" }
  | { status: "completed"; kind: "result"; errorCount: number }
  | { status: "completed"; kind: "no-environment" };

export class JenkinsfileValidationCoordinator
  implements vscode.Disposable, JenkinsfileValidationStatusProvider
{
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("Jenkinsfile");
  private readonly outputChannel = vscode.window.createOutputChannel("Jenkinsfile Validation");
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly lastValidatedState = new Map<string, ValidationCacheEntry>();
  private readonly lastStatusState = new Map<string, JenkinsfileValidationStatusState>();
  private readonly activeTokens = new Map<string, number>();
  private readonly pendingChangeTimers = new Map<string, NodeJS.Timeout>();
  private readonly changeTokenSources = new Map<string, vscode.CancellationTokenSource>();
  private readonly statusEmitter = new vscode.EventEmitter<vscode.Uri>();
  private config: JenkinsfileValidationConfig;
  private tokenCounter = 0;

  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    private readonly environmentResolver: JenkinsfileEnvironmentResolver,
    private readonly statusBar: JenkinsfileValidationStatusBar,
    private readonly matcher: JenkinsfileMatcher,
    config: JenkinsfileValidationConfig
  ) {
    this.config = config;
  }

  readonly onDidChangeValidationStatus = this.statusEmitter.event;

  start(): void {
    this.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!this.config.enabled || !this.config.runOnSave) {
          return;
        }
        if (!this.matcher.matches(document)) {
          return;
        }
        this.cancelChangeValidation(document);
        void this.validateDocument(document, { reason: "save" });
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (!this.config.enabled) {
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
    const state = this.lastStatusState.get(document.uri.toString());
    if (!state) {
      return undefined;
    }
    if (state.kind === "no-environment") {
      return null;
    }
    return state.environment;
  }

  getValidationState(document: vscode.TextDocument): JenkinsfileValidationStatusState | undefined {
    const state = this.lastStatusState.get(document.uri.toString());
    if (!state) {
      return undefined;
    }
    if (state.kind === "no-environment") {
      return { kind: "no-environment" };
    }
    return {
      kind: "result",
      errorCount: state.errorCount,
      environment: state.environment,
      stale: state.stale
    };
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
    const documents = this.getStatusUris();
    this.diagnostics.clear();
    this.lastValidatedState.clear();
    this.lastStatusState.clear();
    this.activeTokens.clear();
    this.cancelAllChangeValidations();
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

  dispose(): void {
    this.diagnostics.dispose();
    this.outputChannel.dispose();
    this.cancelAllChangeValidations();
    this.statusEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private async validateDocument(
    document: vscode.TextDocument,
    options: ValidationRequestOptions
  ): Promise<ValidationOutcome> {
    const text = document.getText();
    const hash = hashText(text);
    const key = document.uri.toString();
    const cached = this.lastValidatedState.get(key);
    if (!this.matcher.matches(document)) {
      this.diagnostics.delete(document.uri);
      this.statusBar.clear(document);
      return { status: "skipped" };
    }

    const token = this.nextToken(key);
    this.statusBar.setValidating(document);
    const cancellationSubscription = options.cancellationToken?.onCancellationRequested(() => {
      if (this.isActiveToken(key, token)) {
        this.restoreStatusBar(document);
      }
    });

    try {
      const canceledBeforeLookup = this.getCancellationOutcome(document, options);
      if (canceledBeforeLookup) {
        return canceledBeforeLookup;
      }

      const environment = await this.environmentResolver.resolveForDocument(document);
      const activeAfterLookup = this.getActiveOutcome(document, options, key, token);
      if (activeAfterLookup) {
        return activeAfterLookup;
      }

      if (!environment) {
        this.logNoEnvironment(document, options.reason);
        const diagnostic = buildNoEnvironmentDiagnostic(document);
        this.diagnostics.set(document.uri, [diagnostic]);
        this.setNoEnvironmentState(document);
        return { status: "completed", kind: "no-environment" };
      }

      const environmentKey = buildEnvironmentKey(environment);
      if (!options.force && cached && cached.hash === hash) {
        if (cached.environmentKey === environmentKey) {
          this.setResultStaleState(document, false);
          this.restoreStatusBar(document);
          return { status: "skipped" };
        }
      }

      this.statusBar.setValidating(document, environment);
      const canceledAfterStatus = this.getCancellationOutcome(document, options);
      if (canceledAfterStatus) {
        return canceledAfterStatus;
      }

      let output = "";
      let requestFailed = false;
      try {
        const client = await this.clientProvider.getClient(environment);
        output = await client.validateDeclarativeJenkinsfile(text);
      } catch (error) {
        requestFailed = true;
        output = `Validation request failed: ${formatError(error)}`;
      }

      const activeAfterRequest = this.getActiveOutcome(document, options, key, token);
      if (activeAfterRequest) {
        return activeAfterRequest;
      }

      if (requestFailed) {
        this.lastValidatedState.delete(key);
      } else {
        this.lastValidatedState.set(key, { hash, environmentKey });
      }
      this.logValidation(document, environment, output, options.reason);

      const activeBeforeApply = this.getActiveOutcome(document, options, key, token);
      if (activeBeforeApply) {
        return activeBeforeApply;
      }

      const findings = parseDeclarativeValidationOutput(output);
      const diagnostics = this.buildDiagnostics(document, findings);
      if (document.isClosed) {
        return { status: "skipped" };
      }
      if (diagnostics.length === 0) {
        this.diagnostics.delete(document.uri);
      } else {
        this.diagnostics.set(document.uri, diagnostics);
      }

      this.setResultState(document, findings.length, environment);
      return { status: "completed", kind: "result", errorCount: findings.length };
    } finally {
      cancellationSubscription?.dispose();
    }
  }

  showOutputChannel(): void {
    this.outputChannel.show(true);
  }

  private buildDiagnostics(
    document: vscode.TextDocument,
    findings: JenkinsfileValidationFinding[]
  ): vscode.Diagnostic[] {
    if (findings.length === 0) {
      return [];
    }
    const diagnostics: vscode.Diagnostic[] = [];
    const lineCount = Math.max(document.lineCount, 1);

    for (const finding of findings) {
      const range = resolveFindingRange(document, finding, lineCount);
      const diagnostic = new vscode.Diagnostic(
        range,
        finding.message,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.source = JENKINS_DIAGNOSTIC_SOURCE;
      if (finding.code) {
        diagnostic.code = finding.code;
      }
      if (finding.suggestions?.length) {
        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(document.uri, range),
            `Possible steps: ${finding.suggestions.join(", ")}`
          )
        ];
      }
      setDiagnosticMetadata(diagnostic, {
        code: finding.code,
        suggestions: finding.suggestions,
        invalidStepToken: finding.invalidStepToken
      });
      diagnostics.push(diagnostic);
    }

    return diagnostics;
  }

  private setResultState(
    document: vscode.TextDocument,
    errorCount: number,
    environment?: JenkinsEnvironmentRef,
    stale = false
  ): void {
    const nextState: JenkinsfileValidationStatusState = {
      kind: "result",
      errorCount,
      environment,
      stale
    };
    const changed = this.updateStatusState(document, nextState);
    this.statusBar.setResult(document, errorCount, environment, stale);
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private setResultStaleState(document: vscode.TextDocument, stale: boolean): void {
    const key = document.uri.toString();
    const lastState = this.lastStatusState.get(key);
    if (!lastState || lastState.kind !== "result") {
      return;
    }
    const wasStale = Boolean(lastState.stale);
    if (wasStale === stale) {
      return;
    }
    this.setResultState(document, lastState.errorCount, lastState.environment, stale);
  }

  private setNoEnvironmentState(document: vscode.TextDocument): void {
    const nextState: JenkinsfileValidationStatusState = { kind: "no-environment" };
    const changed = this.updateStatusState(document, nextState);
    this.statusBar.setNoEnvironment(document);
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private scheduleChangeValidation(document: vscode.TextDocument): void {
    if (!this.config.enabled) {
      return;
    }
    const debounceMs = this.config.changeDebounceMs;
    if (debounceMs === 0) {
      this.cancelChangeValidation(document);
      this.triggerChangeValidation(document);
      return;
    }

    this.cancelChangeValidation(document);
    const key = document.uri.toString();
    const timer = setTimeout(() => {
      this.pendingChangeTimers.delete(key);
      this.triggerChangeValidation(document);
    }, debounceMs);
    this.pendingChangeTimers.set(key, timer);
  }

  private triggerChangeValidation(document: vscode.TextDocument): void {
    if (!this.config.enabled || document.isClosed) {
      return;
    }
    const key = document.uri.toString();
    const tokenSource = new vscode.CancellationTokenSource();
    this.changeTokenSources.set(key, tokenSource);
    void this.validateDocument(document, {
      reason: "change",
      cancellationToken: tokenSource.token
    }).finally(() => {
      if (this.changeTokenSources.get(key) === tokenSource) {
        this.changeTokenSources.delete(key);
      }
      tokenSource.dispose();
    });
  }

  private cancelChangeValidation(document: vscode.TextDocument): void {
    const key = document.uri.toString();
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

  private nextToken(key: string): number {
    const token = this.tokenCounter + 1;
    this.tokenCounter = token;
    this.activeTokens.set(key, token);
    return token;
  }

  private isActiveToken(key: string, token: number): boolean {
    return this.activeTokens.get(key) === token;
  }

  private clearDocumentState(document: vscode.TextDocument): void {
    this.cancelChangeValidation(document);
    const key = document.uri.toString();
    this.lastValidatedState.delete(key);
    const changed = this.updateStatusState(document, undefined);
    this.activeTokens.delete(key);
    this.diagnostics.delete(document.uri);
    this.statusBar.clear(document);
    this.emitStatusChangeIfNeeded(document, changed);
  }

  private restoreStatusBar(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const lastState = this.lastStatusState.get(key);
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
    this.statusBar.clear(document);
  }

  private logNoEnvironment(document: vscode.TextDocument, reason: ValidationReason): void {
    this.appendLogHeader(document, reason);
    this.outputChannel.appendLine("No Jenkins environment configured for validation.");
    this.outputChannel.appendLine("");
  }

  private logValidation(
    document: vscode.TextDocument,
    environment: JenkinsEnvironmentRef,
    output: string,
    reason: ValidationReason
  ): void {
    this.appendLogHeader(document, reason);
    this.outputChannel.appendLine(
      `Environment: ${environment.url} (${environment.scope}, ${environment.environmentId})`
    );
    this.outputChannel.appendLine(output.trim() || "<no output>");
    this.outputChannel.appendLine("");
  }

  private appendLogHeader(document: vscode.TextDocument, reason: ValidationReason): void {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    this.outputChannel.appendLine(
      `[${new Date().toISOString()}] Jenkinsfile validation (${reason})`
    );
    this.outputChannel.appendLine(`File: ${document.uri.fsPath}`);
    this.outputChannel.appendLine(
      `Workspace: ${workspaceFolder ? workspaceFolder.name : "No workspace"}`
    );
  }

  private getCancellationOutcome(
    document: vscode.TextDocument,
    options: ValidationRequestOptions
  ): ValidationOutcome | undefined {
    if (!options.cancellationToken?.isCancellationRequested) {
      return undefined;
    }
    this.restoreStatusBar(document);
    return { status: "canceled" };
  }

  private getActiveOutcome(
    document: vscode.TextDocument,
    options: ValidationRequestOptions,
    key: string,
    token: number
  ): ValidationOutcome | undefined {
    if (document.isClosed) {
      return { status: "skipped" };
    }
    if (!this.isActiveToken(key, token)) {
      return { status: "skipped" };
    }
    return this.getCancellationOutcome(document, options);
  }

  private updateStatusState(
    document: vscode.TextDocument,
    nextState: JenkinsfileValidationStatusState | undefined
  ): boolean {
    const key = document.uri.toString();
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

  private emitStatusChangeIfNeeded(document: vscode.TextDocument, changed: boolean): void {
    if (!changed) {
      return;
    }
    this.statusEmitter.fire(document.uri);
  }
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
  return [
    environment.environmentId,
    environment.scope,
    environment.url,
    environment.username ?? ""
  ].join("|");
}

function arePatternsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
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
  return buildEnvironmentKey(environment);
}

function buildNoEnvironmentDiagnostic(document: vscode.TextDocument): vscode.Diagnostic {
  const lineText = document.lineCount > 0 ? document.lineAt(0).text : "";
  const range = buildLineRange(0, lineText);
  const diagnostic = new vscode.Diagnostic(
    range,
    "Select a Jenkins environment to enable Jenkinsfile validation.",
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = JENKINS_DIAGNOSTIC_SOURCE;
  diagnostic.code = "no-environment";
  setDiagnosticMetadata(diagnostic, { code: "no-environment" });
  return diagnostic;
}

function resolveFindingRange(
  document: vscode.TextDocument,
  finding: JenkinsfileValidationFinding,
  lineCount: number
): vscode.Range {
  const lineNumber = typeof finding.line === "number" ? finding.line : 1;
  const clampedLine = Math.min(Math.max(1, lineNumber), lineCount) - 1;
  const lineText = document.lineAt(clampedLine).text;

  if (typeof finding.column === "number" && Number.isFinite(finding.column)) {
    return resolveRangeFromColumn(clampedLine, lineText, finding.column);
  }

  const tokenHint = deriveTokenHint(finding.message);
  if (tokenHint) {
    const tokenIndex = findTokenOccurrence(lineText, tokenHint);
    if (tokenIndex !== undefined) {
      return buildTokenRange(clampedLine, tokenIndex, tokenHint.length);
    }

    if (tokenHint === "pipeline") {
      const pipelineRange = findFirstTokenInDocument(document, tokenHint);
      if (pipelineRange) {
        return pipelineRange;
      }
    }
  }

  return buildLineRange(clampedLine, lineText);
}

function resolveRangeFromColumn(lineIndex: number, lineText: string, column: number): vscode.Range {
  const lineLength = lineText.length;
  if (lineLength === 0) {
    return buildLineRange(lineIndex, lineText);
  }

  const startIndex = Math.min(Math.max(1, column) - 1, lineLength);
  let index = startIndex;
  while (index < lineLength && isWhitespace(lineText[index])) {
    index += 1;
  }

  if (index >= lineLength) {
    return buildLineRange(lineIndex, lineText);
  }

  if (!isTokenChar(lineText[index])) {
    return new vscode.Range(lineIndex, index, lineIndex, lineLength);
  }

  let end = index + 1;
  while (end < lineLength && isTokenChar(lineText[end])) {
    end += 1;
  }
  return new vscode.Range(lineIndex, index, lineIndex, end);
}

function buildLineRange(lineIndex: number, lineText: string): vscode.Range {
  if (lineText.length === 0) {
    return new vscode.Range(lineIndex, 0, lineIndex, 0);
  }
  const firstNonWhitespace = lineText.search(/\S/);
  const start = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
  return new vscode.Range(lineIndex, start, lineIndex, lineText.length);
}

function deriveTokenHint(message: string): string | undefined {
  const missingSectionMatch = message.match(/Missing required section ['"]([^'"]+)['"]/i);
  if (missingSectionMatch) {
    const section = missingSectionMatch[1].trim().toLowerCase();
    if (section === "stages" || section === "agent") {
      return "pipeline";
    }
    return section.length > 0 ? section : undefined;
  }

  const invalidSectionMatch = message.match(
    /Invalid section definition ['"]?([A-Za-z0-9_-]+)['"]?/i
  );
  if (invalidSectionMatch) {
    return invalidSectionMatch[1].trim().toLowerCase();
  }

  const unknownSectionMatch = message.match(/Unknown section ['"]?([A-Za-z0-9_-]+)['"]?/i);
  if (unknownSectionMatch) {
    return unknownSectionMatch[1].trim().toLowerCase();
  }

  return undefined;
}

function findFirstTokenInDocument(
  document: vscode.TextDocument,
  token: string
): vscode.Range | undefined {
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const tokenIndex = findTokenOccurrence(lineText, token);
    if (tokenIndex !== undefined) {
      return buildTokenRange(lineIndex, tokenIndex, token.length);
    }
  }
  return undefined;
}

function buildTokenRange(lineIndex: number, start: number, length: number): vscode.Range {
  return new vscode.Range(lineIndex, start, lineIndex, start + length);
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && /\s/.test(value);
}
