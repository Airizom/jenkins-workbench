import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileMatcher } from "./JenkinsfileMatcher";

type JenkinsfileValidationState =
  | {
      kind: "validating";
      environment?: JenkinsEnvironmentRef;
    }
  | {
      kind: "no-environment";
    }
  | {
      kind: "result";
      errorCount: number;
      environment?: JenkinsEnvironmentRef;
      stale?: boolean;
    };

export class JenkinsfileValidationStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly states = new Map<string, JenkinsfileValidationState>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeDocumentKey?: string;

  constructor(private readonly matcher: JenkinsfileMatcher) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.handleActiveEditorChange(editor);
      })
    );
    this.handleActiveEditorChange(vscode.window.activeTextEditor);
  }

  setValidating(document: vscode.TextDocument, environment?: JenkinsEnvironmentRef): void {
    if (!this.matcher.matches(document)) {
      return;
    }
    this.updateState(document, { kind: "validating", environment });
  }

  setResult(
    document: vscode.TextDocument,
    errorCount: number,
    environment?: JenkinsEnvironmentRef,
    stale = false
  ): void {
    if (!this.matcher.matches(document)) {
      return;
    }
    this.updateState(document, { kind: "result", errorCount, environment, stale });
  }

  setNoEnvironment(document: vscode.TextDocument): void {
    if (!this.matcher.matches(document)) {
      return;
    }
    this.updateState(document, { kind: "no-environment" });
  }

  clear(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.states.delete(key);
    if (this.activeDocumentKey === key) {
      this.item.hide();
    }
  }

  clearAll(): void {
    this.states.clear();
    this.item.hide();
  }

  refreshActiveDocument(): void {
    this.handleActiveEditorChange(vscode.window.activeTextEditor);
  }

  handleActiveEditorChange(editor?: vscode.TextEditor): void {
    if (!editor || !this.matcher.matches(editor.document)) {
      this.activeDocumentKey = undefined;
      this.item.hide();
      return;
    }

    const key = editor.document.uri.toString();
    this.activeDocumentKey = key;
    const state = this.states.get(key);
    if (!state) {
      this.item.hide();
      return;
    }
    this.renderState(state);
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private updateState(document: vscode.TextDocument, state: JenkinsfileValidationState): void {
    const key = document.uri.toString();
    this.states.set(key, state);
    if (this.activeDocumentKey === key) {
      this.renderState(state);
    }
  }

  private renderState(state: JenkinsfileValidationState): void {
    if (state.kind === "validating") {
      this.item.text = "$(sync~spin) Validating...";
      this.item.color = undefined;
      this.item.tooltip = this.buildTooltip("Validating...", state.environment);
      this.item.command = "jenkinsWorkbench.jenkinsfile.showValidationOutput";
      this.item.show();
      return;
    }

    if (state.kind === "no-environment") {
      this.item.text = "$(warning) Select validation environment";
      this.item.color = new vscode.ThemeColor("statusBarItem.warningForeground");
      this.item.tooltip = "Jenkinsfile validation: environment not configured";
      this.item.command = "jenkinsWorkbench.jenkinsfile.selectValidationEnvironment";
      this.item.show();
      return;
    }

    const isStale = Boolean(state.stale);
    const stateSuffix = isStale ? " (stale)" : "";
    const stateLabel =
      state.errorCount > 0 ? `Errors: ${state.errorCount}${stateSuffix}` : `Valid${stateSuffix}`;
    const icon = state.errorCount > 0 ? "$(error)" : "$(check)";
    let color: vscode.ThemeColor | undefined;
    if (isStale) {
      color = new vscode.ThemeColor("statusBarItem.inactiveForeground");
    } else if (state.errorCount > 0) {
      color = new vscode.ThemeColor("statusBarItem.errorForeground");
    }
    this.item.text = `${icon} ${stateLabel}`;
    this.item.color = color;
    this.item.tooltip = this.buildTooltip(stateLabel, state.environment);
    this.item.command = "jenkinsWorkbench.jenkinsfile.showValidationOutput";
    this.item.show();
  }

  private buildTooltip(stateLabel: string, environment?: JenkinsEnvironmentRef): string {
    const lines = [`Jenkinsfile validation: ${stateLabel}`];
    if (environment) {
      const environmentLabel = `${environment.url} (${environment.scope}, ${environment.environmentId})`;
      lines.push(`Environment: ${environmentLabel}`);
    }
    return lines.join("\n");
  }
}
