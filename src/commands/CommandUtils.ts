import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import { formatEnvironmentDisplayName } from "../jenkins/EnvironmentLabels";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
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

export async function pickJenkinsEnvironment(
  store: Pick<JenkinsEnvironmentStore, "listEnvironmentsWithScope">,
  copy: { emptyMessage: string; placeHolder: string }
): Promise<JenkinsEnvironmentRef | undefined> {
  const environments = await store.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage(copy.emptyMessage);
    return undefined;
  }
  if (environments.length === 1) {
    return toJenkinsEnvironmentRef(environments[0]);
  }

  const pick = await vscode.window.showQuickPick(
    environments.map((environment) => ({
      label: formatEnvironmentDisplayName(environment),
      description: environment.username
        ? `${environment.scope} · ${environment.username}`
        : environment.scope,
      environment
    })),
    { placeHolder: copy.placeHolder, matchOnDescription: true }
  );
  return pick ? toJenkinsEnvironmentRef(pick.environment) : undefined;
}
