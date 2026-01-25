import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "../JenkinsfileMatcher";
import type {
  JenkinsfileValidationStatusProvider,
  JenkinsfileValidationStatusState
} from "../JenkinsfileValidationStatusProvider";
import { findPipelineBlock } from "./JenkinsfilePipelineParser";

export class JenkinsfileValidationCodeLensProvider
  implements vscode.CodeLensProvider, vscode.Disposable
{
  private readonly codeLensEmitter = new vscode.EventEmitter<void>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly matcher: JenkinsfileMatcher,
    private readonly statusProvider: JenkinsfileValidationStatusProvider
  ) {
    this.statusProvider.onDidChangeValidationStatus(this.refresh, this, this.subscriptions);
  }

  readonly onDidChangeCodeLenses = this.codeLensEmitter.event;

  refresh(uri: vscode.Uri): void {
    if (!this.shouldRefresh(uri)) {
      return;
    }
    this.codeLensEmitter.fire();
  }

  dispose(): void {
    this.codeLensEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.matcher.matches(document)) {
      return [];
    }

    const pipelineContext = findPipelineBlock(document);
    if (!pipelineContext) {
      return [];
    }

    const range = new vscode.Range(pipelineContext.openLine, 0, pipelineContext.openLine, 0);
    const state = this.statusProvider.getValidationState(document);
    const command = this.buildCommand(state);

    return [new vscode.CodeLens(range, command)];
  }

  private shouldRefresh(uri: vscode.Uri): boolean {
    return vscode.window.visibleTextEditors.some((editor) => {
      return (
        editor.document.uri.toString() === uri.toString() && this.matcher.matches(editor.document)
      );
    });
  }

  private buildCommand(state: JenkinsfileValidationStatusState | undefined): vscode.Command {
    const validateCommandId = "jenkinsWorkbench.jenkinsfile.validateActive";
    if (!state) {
      return {
        title: "Validate Jenkinsfile",
        command: validateCommandId
      };
    }

    if (state.kind === "no-environment") {
      return {
        title: "$(warning) Select validation environment",
        command: "jenkinsWorkbench.jenkinsfile.selectValidationEnvironment"
      };
    }

    const staleSuffix = state.stale ? " (stale)" : "";
    if (state.errorCount > 0) {
      return {
        title: `$(error) ${state.errorCount} errors${staleSuffix}`,
        command: validateCommandId
      };
    }

    return {
      title: `$(check) Valid${staleSuffix}`,
      command: validateCommandId
    };
  }
}
