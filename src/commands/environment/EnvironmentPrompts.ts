import * as vscode from "vscode";
import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";

export async function promptScope(): Promise<EnvironmentScope | undefined> {
  const pickItems: Array<vscode.QuickPickItem & { scope: EnvironmentScope }> = [
    {
      label: "Workspace",
      description: "Only available in this workspace",
      scope: "workspace"
    },
    {
      label: "Global",
      description: "Available in all workspaces",
      scope: "global"
    }
  ];

  const pick = await vscode.window.showQuickPick(pickItems, {
    placeHolder: "Choose where to store this environment",
    matchOnDescription: true
  });

  return pick?.scope;
}

export async function promptRequiredInput(
  prompt: string,
  placeHolder?: string,
  password = false
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt,
    placeHolder,
    password,
    ignoreFocusOut: true,
    validateInput: (input) => (input.trim().length === 0 ? `${prompt} is required.` : undefined)
  });

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function promptOptionalInput(
  prompt: string,
  placeHolder?: string,
  password = false
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt,
    placeHolder,
    password,
    ignoreFocusOut: true
  });

  if (value === undefined) {
    return undefined;
  }

  return value.trim();
}
