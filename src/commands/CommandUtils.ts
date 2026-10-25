import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import { resolveTreeItemLabel } from "../tree/TreeItemLabels";
import { withActionErrorMessage } from "../ui/ActionErrorMessage";

export { formatActionError, withActionErrorMessage };

interface FullEnvironmentRefreshHost {
  fullEnvironmentRefresh(options: { environmentId: string }): void;
}

export function getTreeItemLabel(item: vscode.TreeItem): string {
  return resolveTreeItemLabel(item) ?? "item";
}

export function createEnvironmentRefreshCallback(
  refreshHost: FullEnvironmentRefreshHost
): (environmentId: string) => void {
  return (environmentId) => {
    refreshHost.fullEnvironmentRefresh({ environmentId });
  };
}

export function requireSelection<T>(
  item: T | undefined,
  missingSelectionMessage: string
): T | undefined {
  if (!item) {
    void vscode.window.showInformationMessage(missingSelectionMessage);
    return undefined;
  }
  return item;
}

export async function confirmModalAction(prompt: string, actionLabel: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(prompt, { modal: true }, actionLabel);
  return choice === actionLabel;
}
