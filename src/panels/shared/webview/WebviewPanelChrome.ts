import * as vscode from "vscode";
import { getWebviewAssetsRoot } from "./WebviewAssets";

export function configureWebviewPanel(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  iconName: "server" | "terminal"
): void {
  panel.webview.options = {
    enableScripts: true,
    localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
  };
  panel.iconPath = getIconPaths(extensionUri, iconName);
}

function getIconPaths(
  extensionUri: vscode.Uri,
  iconName: "server" | "terminal"
): { light: vscode.Uri; dark: vscode.Uri } {
  const lightIconPath = vscode.Uri.joinPath(
    extensionUri,
    "resources",
    "codicons",
    `${iconName}-light.svg`
  );
  const darkIconPath = vscode.Uri.joinPath(
    extensionUri,
    "resources",
    "codicons",
    `${iconName}-dark.svg`
  );
  return { light: lightIconPath, dark: darkIconPath };
}
