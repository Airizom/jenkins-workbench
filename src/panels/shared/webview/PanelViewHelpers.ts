import type * as vscode from "vscode";
import type { LoadingSkeletonVariant } from "./LoadingSkeletonHtml";
import {
  type ResolvedWebviewAssets,
  resolveWebviewAssets,
  type WebviewEntryName
} from "./WebviewAssets";
import {
  assignWebviewPanelManifestErrorHtml,
  type PanelDetailsRenderOptions,
  type PanelManifestErrorOptions,
  renderPanelLoadingHtml
} from "./WebviewHtml";

export type PanelViewAssets = ResolvedWebviewAssets;

export interface EnvironmentPanelRenderOptions {
  nonce: string;
  panelState?: unknown;
}

export interface PanelLoadingShellOptions {
  panel: vscode.WebviewPanel;
  extensionUri: vscode.Uri;
  entryName: WebviewEntryName;
  nonce: string;
  panelState?: unknown;
  errorOptions?: PanelManifestErrorOptions;
  renderLoadingHtml: (options: PanelDetailsRenderOptions) => string;
}

export class EnvironmentPanelView<TModel> {
  constructor(
    protected readonly panel: vscode.WebviewPanel,
    protected readonly extensionUri: vscode.Uri,
    private readonly entryName: WebviewEntryName,
    private readonly skeletonVariant: LoadingSkeletonVariant,
    private readonly defaultTitle: string,
    private readonly renderPanelHtml: (model: TModel, options: PanelDetailsRenderOptions) => string
  ) {}

  resolveAssets(): PanelViewAssets | undefined {
    return resolvePanelAssets(this.panel, this.extensionUri, this.entryName);
  }

  resolveAssetsAndRenderLoading(
    options: EnvironmentPanelRenderOptions
  ): PanelViewAssets | undefined {
    return resolvePanelAssetsAndRenderLoading({
      panel: this.panel,
      extensionUri: this.extensionUri,
      entryName: this.entryName,
      nonce: options.nonce,
      panelState: options.panelState,
      renderLoadingHtml: (renderOptions) =>
        renderPanelLoadingHtml(renderOptions, this.skeletonVariant)
    });
  }

  renderModel(
    model: TModel,
    assets: PanelViewAssets,
    options: EnvironmentPanelRenderOptions
  ): void {
    this.panel.webview.html = this.renderPanelHtml(model, {
      cspSource: this.panel.webview.cspSource,
      nonce: options.nonce,
      scriptUri: assets.scriptUri,
      styleUris: assets.styleUris,
      panelState: options.panelState
    });
  }

  setTitle(label?: string): void {
    this.panel.title = label ? `${this.defaultTitle} - ${label}` : this.defaultTitle;
  }
}

function resolvePanelAssets(
  panel: vscode.WebviewPanel,
  extensionUri: vscode.Uri,
  entryName: WebviewEntryName,
  errorOptions?: PanelManifestErrorOptions
): PanelViewAssets | undefined {
  try {
    return resolveWebviewAssets(panel.webview, extensionUri, entryName);
  } catch {
    if (errorOptions) {
      assignWebviewPanelManifestErrorHtml(panel, extensionUri, entryName, errorOptions);
    }
    return undefined;
  }
}

export function resolvePanelAssetsAndRenderLoading(
  options: PanelLoadingShellOptions
): PanelViewAssets | undefined {
  const assets = resolvePanelAssets(
    options.panel,
    options.extensionUri,
    options.entryName,
    options.errorOptions
      ? {
          ...options.errorOptions,
          panelState: options.panelState
        }
      : undefined
  );
  if (!assets) {
    return undefined;
  }

  assignPanelLoadingHtml(options.panel, options.renderLoadingHtml, {
    nonce: options.nonce,
    styleUris: assets.styleUris,
    panelState: options.panelState
  });
  return assets;
}

function assignPanelLoadingHtml(
  panel: vscode.WebviewPanel,
  renderLoadingHtml: (options: PanelDetailsRenderOptions) => string,
  options: Omit<PanelDetailsRenderOptions, "cspSource" | "scriptUri">
): void {
  panel.webview.html = renderLoadingHtml({
    ...options,
    cspSource: panel.webview.cspSource
  });
}
