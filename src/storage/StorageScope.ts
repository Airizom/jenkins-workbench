import type * as vscode from "vscode";
import type { EnvironmentScope } from "./JenkinsEnvironmentStore";

export function getScopedMemento(
  context: vscode.ExtensionContext,
  scope: EnvironmentScope
): vscode.Memento {
  return scope === "workspace" ? context.workspaceState : context.globalState;
}

export function toRepositoryKey(repositoryUri: vscode.Uri | string): string {
  return typeof repositoryUri === "string" ? repositoryUri : repositoryUri.toString();
}
