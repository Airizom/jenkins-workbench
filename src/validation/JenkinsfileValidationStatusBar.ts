import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileMatcher } from "./JenkinsfileMatcher";
import type {
  JenkinsfileValidationStatusProvider,
  JenkinsfileValidationStatusState
} from "./JenkinsfileValidationStatusProvider";

const SELECT_ENVIRONMENT_COMMAND = "jenkinsWorkbench.jenkinsfile.selectValidationEnvironment";
const SHOW_OUTPUT_COMMAND = "jenkinsWorkbench.jenkinsfile.showValidationOutput";

type ValidatingState = {
  kind: "validating";
  environment?: JenkinsEnvironmentRef;
};

type JenkinsfileValidationState = ValidatingState | JenkinsfileValidationStatusState;

export class JenkinsfileValidationStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly validatingStates = new Map<string, ValidatingState>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeDocumentKey?: string;

  constructor(
    private readonly matcher: JenkinsfileMatcher,
    private readonly statusProvider: Pick<JenkinsfileValidationStatusProvider, "getValidationState">
  ) {
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
    const state: ValidatingState = { kind: "validating", environment };
    const key = document.uri.toString();
    this.validatingStates.set(key, state);
    if (this.activeDocumentKey === key) {
      this.renderState(state);
    }
  }

  refresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.validatingStates.delete(key);
    if (this.activeDocumentKey === key) {
      this.renderDocument(document);
    }
  }

  clear(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.validatingStates.delete(key);
    if (this.activeDocumentKey === key) {
      this.item.hide();
    }
  }

  clearAll(): void {
    this.validatingStates.clear();
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
    this.renderDocument(editor.document);
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private renderDocument(document: vscode.TextDocument): void {
    if (!this.matcher.matches(document)) {
      this.item.hide();
      return;
    }
    const key = document.uri.toString();
    const state =
      this.validatingStates.get(key) ?? this.statusProvider.getValidationState(document);
    if (!state) {
      this.item.hide();
      return;
    }
    this.renderState(state);
  }

  private renderState(state: JenkinsfileValidationState): void {
    if (state.kind === "validating") {
      this.renderItem(
        "$(sync~spin) Validating...",
        this.buildTooltip("Validating...", state.environment),
        SHOW_OUTPUT_COMMAND
      );
      return;
    }

    if (state.kind === "no-environment") {
      this.renderItem(
        "$(warning) Select Jenkinsfile environment",
        "Jenkinsfile features: environment not configured",
        SELECT_ENVIRONMENT_COMMAND,
        new vscode.ThemeColor("statusBarItem.warningForeground")
      );
      return;
    }

    if (state.kind === "request-failed") {
      this.renderItem(
        "$(warning) Validation unavailable",
        this.buildTooltip("Validation unavailable", state.environment, state.message),
        SHOW_OUTPUT_COMMAND,
        new vscode.ThemeColor("statusBarItem.warningForeground")
      );
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
    this.renderItem(
      `${icon} ${stateLabel}`,
      this.buildTooltip(stateLabel, state.environment),
      SHOW_OUTPUT_COMMAND,
      color
    );
  }

  private renderItem(
    text: string,
    tooltip: string,
    command: string,
    color?: vscode.ThemeColor
  ): void {
    this.item.text = text;
    this.item.color = color;
    this.item.tooltip = tooltip;
    this.item.command = command;
    this.item.show();
  }

  private buildTooltip(
    stateLabel: string,
    environment?: JenkinsEnvironmentRef,
    detail?: string
  ): string {
    const lines = [`Jenkinsfile validation: ${stateLabel}`];
    if (environment) {
      const environmentLabel = `${environment.url} (${environment.scope}, ${environment.environmentId})`;
      lines.push(`Jenkinsfile environment: ${environmentLabel}`);
    }
    if (detail) {
      lines.push(detail);
    }
    return lines.join("\n");
  }
}
