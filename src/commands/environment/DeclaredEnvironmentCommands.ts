import * as vscode from "vscode";
import type { DeclaredEnvironmentRegistry } from "../../environments/sharing/DeclaredEnvironmentRegistry";
import {
  type DeclaredEnvironment,
  ENVIRONMENTS_SETTING
} from "../../environments/sharing/DeclaredEnvironmentSource";
import { formatError } from "../../formatters/ErrorFormatters";
import { formatScopeLabel } from "../../formatters/ScopeFormatters";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsEnvironmentStore } from "../../storage/JenkinsEnvironmentStore";
import {
  formatEnvironmentTitle,
  formatJenkinsUrlForDisplay,
  toEnvironmentTarget
} from "./EnvironmentCommandHelpers";
import type { EnvironmentCommandRefreshHost } from "./EnvironmentCommandTypes";

export type DeclaredEnvironmentEditAction = "signIn" | "credentials" | "openSettings";

/** Shared environments are edited in settings; only sign-in and credentials are local. */
export async function promptDeclaredEnvironmentEditAction(
  needsSignIn: boolean,
  credentialsDescription: string
): Promise<DeclaredEnvironmentEditAction | undefined> {
  const items: Array<vscode.QuickPickItem & { action: DeclaredEnvironmentEditAction }> = [
    needsSignIn
      ? { label: "Sign In", description: "Sign in required", action: "signIn" }
      : {
          label: "Update Credentials",
          description: credentialsDescription,
          action: "credentials"
        },
    {
      label: "Open in Settings",
      description: "Name, URL and sign-in method are set in settings",
      action: "openSettings"
    }
  ];
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "This environment is shared through settings",
    matchOnDescription: true
  });
  return pick?.action;
}

/** Opens the settings file that declares a shared environment, at its entry when possible. */
export async function openEnvironmentDeclaration(
  store: JenkinsEnvironmentStore,
  registry: Pick<DeclaredEnvironmentRegistry, "getDeclaration">,
  item?: JenkinsEnvironmentRef
): Promise<boolean> {
  const target = item ? toEnvironmentTarget(item) : await promptDeclaredTarget(store);
  if (!target) {
    return false;
  }
  const declaration = registry.getDeclaration(target.scope, target.id);
  if (!declaration) {
    await openSettingsUi();
    return false;
  }
  try {
    const editor = await openDeclaringSettingsFile(declaration);
    if (!editor) {
      await openSettingsUi();
      return false;
    }
    revealDeclaration(editor, declaration.slug);
    return true;
  } catch (error) {
    console.warn("Failed to open the Jenkins environment settings file.", error);
    await openSettingsUi();
    return false;
  }
}

/** Restores environments hidden in this window. */
export async function showHiddenEnvironments(
  registry: Pick<DeclaredEnvironmentRegistry, "listHiddenEnvironments" | "unhideEnvironment">,
  refreshHost: EnvironmentCommandRefreshHost
): Promise<number> {
  const hidden = await registry.listHiddenEnvironments();
  if (hidden.length === 0) {
    void vscode.window.showInformationMessage("No Jenkins environments are hidden.");
    return 0;
  }
  const picks = hidden.map((environment) => ({
    label: formatEnvironmentTitle(environment),
    description: [
      formatScopeLabel(environment.scope),
      environment.hidden === "declared" ? "Shared" : "Linked to shared definition"
    ].join(" • "),
    detail: formatJenkinsUrlForDisplay(environment.url),
    environment
  }));
  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select the environments to show again",
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!selected || selected.length === 0) {
    return 0;
  }
  const results = await Promise.allSettled(
    selected.map(({ environment }) => registry.unhideEnvironment(environment.scope, environment.id))
  );
  refreshHost.fullEnvironmentRefresh();
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    void vscode.window.showErrorMessage(
      `Some environments could not be shown again: ${failures
        .map((failure) => formatError(failure.reason))
        .join("; ")}`
    );
  }
  return results.length - failures.length;
}

async function promptDeclaredTarget(store: JenkinsEnvironmentStore) {
  const environments = (await store.listEnvironmentsWithScope()).filter((environment) =>
    store.isDeclared(environment.id)
  );
  if (environments.length === 0) {
    void vscode.window.showInformationMessage(
      "No Jenkins environments are shared through settings."
    );
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    environments.map((environment) => ({
      label: formatEnvironmentTitle(environment),
      description: formatScopeLabel(environment.scope),
      detail: formatJenkinsUrlForDisplay(environment.url),
      target: { id: environment.id, url: environment.url, scope: environment.scope }
    })),
    { placeHolder: "Select a shared environment to open in settings", matchOnDetail: true }
  );
  return pick?.target;
}

async function openDeclaringSettingsFile(
  declaration: DeclaredEnvironment
): Promise<vscode.TextEditor | undefined> {
  if (declaration.origin.level === "user") {
    await vscode.commands.executeCommand("workbench.action.openSettingsJson");
    return vscode.window.activeTextEditor;
  }
  const uri = resolveWorkspaceSettingsUri(declaration);
  if (!uri) {
    return undefined;
  }
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document);
}

function resolveWorkspaceSettingsUri(declaration: DeclaredEnvironment): vscode.Uri | undefined {
  if (declaration.origin.level === "folder" && declaration.origin.folderUri) {
    return vscode.Uri.joinPath(
      vscode.Uri.parse(declaration.origin.folderUri),
      ".vscode",
      "settings.json"
    );
  }
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && workspaceFile.scheme !== "untitled") {
    return workspaceFile;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.length === 1
    ? vscode.Uri.joinPath(folders[0].uri, ".vscode", "settings.json")
    : undefined;
}

/** Best effort: selects the line holding `"id": "<slug>"`. */
function revealDeclaration(editor: vscode.TextEditor, slug: string): void {
  const text = editor.document.getText();
  const pattern = new RegExp(`"id"\\s*:\\s*"${escapeRegExp(slug)}"`);
  const match = pattern.exec(text);
  if (!match) {
    return;
  }
  const position = editor.document.positionAt(match.index);
  const range = new vscode.Range(position, position);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openSettingsUi(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.openSettings", ENVIRONMENTS_SETTING);
}
