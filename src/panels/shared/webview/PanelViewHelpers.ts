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

export interface EnvironmentPanelRenderOptions {
  nonce: string;
  panelState?: unknown;
}

export type EnvironmentPanelLoadingRenderOptions = EnvironmentPanelRenderOptions & {
  styleUris: string[];
};

export interface PanelLoadingShellOptions {
  panel: vscode.WebviewPanel;
  extensionUri: vscode.Uri;
  entryName: WebviewEntryName;
  nonce: string;
  panelState?: unknown;
  errorOptions: PanelManifestErrorOptions;
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
    return resolvePanelViewAssets(this.panel.webview, this.extensionUri, this.entryName);
  }

  renderLoading(options: EnvironmentPanelLoadingRenderOptions): void {
    assignPanelLoadingHtml(this.panel, this.skeletonVariant, options);
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

function resolvePanelViewAssets(
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

function resolvePanelWebviewAssetsOrError(
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

export function resolvePanelAssetsAndRenderLoading(
  options: PanelLoadingShellOptions
): PanelViewAssets | undefined {
  const assets = resolvePanelWebviewAssetsOrError(
    options.panel,
    options.extensionUri,
    options.entryName,
    {
      ...options.errorOptions,
      panelState: options.panelState
    }
  );
  if (!assets) {
    return undefined;
  }

  options.panel.webview.html = options.renderLoadingHtml({
    cspSource: options.panel.webview.cspSource,
    nonce: options.nonce,
    styleUris: assets.styleUris,
    panelState: options.panelState
  });
  return assets;
}

function assignPanelLoadingHtml(
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
