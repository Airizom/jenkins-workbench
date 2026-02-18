import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { ValidationReason } from "./JenkinsfileValidationCoordinatorTypes";

export class JenkinsfileValidationOutputLogger {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  show(): void {
    this.outputChannel.show(true);
  }

  logNoEnvironment(document: vscode.TextDocument, reason: ValidationReason): void {
    this.appendLogHeader(document, reason);
    this.outputChannel.appendLine("No Jenkins environment configured for validation.");
    this.outputChannel.appendLine("");
  }

  logValidation(
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
}
