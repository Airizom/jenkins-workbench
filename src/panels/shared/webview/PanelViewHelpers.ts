import type * as vscode from "vscode";
import type { LoadingSkeletonVariant } from "./LoadingSkeletonHtml";
import { type WebviewEntryName, resolveWebviewAssets } from "./WebviewAssets";
import {
  type PanelDetailsRenderOptions,
  type PanelManifestErrorOptions,
  assignWebviewPanelManifestErrorHtml,
  renderPanelLoadingHtml
} from "./WebviewHtml";

export interface PanelViewAssets {
  scriptUri: string;
  styleUris: string[];
}

export function resolvePanelViewAssets(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName
): PanelViewAssets | undefined {
  try {
    return resolveWebviewAssets(webview, extensionUri, entryName);
  } catch {
    return undefined;
  }
}

export function resolvePanelWebviewAssetsOrError(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName,
  errorOptions: PanelManifestErrorOptions
): PanelViewAssets | undefined {
  try {
    return resolveWebviewAssets(panel.webview, extensionUri, entryName);
  } catch {
    assignWebviewPanelManifestErrorHtml(panel, extensionUri, entryName, errorOptions);
    return undefined;
  }
}

export function assignPanelLoadingHtml(
  panel: vscode.WebviewPanel,
  skeletonVariant: LoadingSkeletonVariant,
  options: Omit<PanelDetailsRenderOptions, "cspSource"> & { styleUris: string[] }
): void {
  panel.webview.html = renderPanelLoadingHtml(
    {
      ...options,
      cspSource: panel.webview.cspSource
    },
    skeletonVariant
  );
}
