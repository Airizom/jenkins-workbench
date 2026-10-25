import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash, parseJobUrl } from "../jenkins/urls";
import { isPlainRecord } from "../shared/runtimeGuards";
import type {
  JenkinsEnvironmentStore,
  JenkinsEnvironmentStoreChange
} from "../storage/JenkinsEnvironmentStore";
import { HistoryController, type HistoryDependencies } from "./jobHistory/HistoryController";
import { historyJobDisplayName, normalizeHistoryUi } from "./jobHistory/shared/HistoryContracts";
import { getWebviewAssetsRoot, resolveWebviewAssets } from "./shared/webview/WebviewAssets";
import {
  assignWebviewPanelManifestErrorHtml,
  createMissingPanelAssetsMessages,
  createTypedPanelRenderer
} from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import {
  createSerializedEnvironmentState,
  isSerializedEnvironmentState,
  resolveEnvironmentRef
} from "./shared/webview/WebviewPanelState";

function jobHistoryPanelTitle(jobUrl: string, environmentUrl: string): string {
  return `History: ${historyJobDisplayName(jobUrl, environmentUrl)}`;
}

function jobHistoryPanelKey(environment: JenkinsEnvironmentRef, jobUrl: string): string {
  return JSON.stringify([
    environment.scope,
    environment.environmentId,
    ensureTrailingSlash(jobUrl)
  ]);
}

function isPanelKeyForEnvironment(key: string, scope: string, environmentId: string): boolean {
  const [keyScope, keyEnvironmentId] = JSON.parse(key) as [string, string, string];
  return keyScope === scope && keyEnvironmentId === environmentId;
}

export class JobHistoryPanelLauncher implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>();
  private readonly environmentSubscription: vscode.Disposable;
  constructor(
    private readonly dependencies: HistoryDependencies,
    private readonly extensionUri: vscode.Uri,
    private readonly environments: JenkinsEnvironmentStore
  ) {
    this.environmentSubscription = environments.onDidChange((change) =>
      this.handleEnvironmentChange(change)
    );
  }
  dispose(): void {
    this.environmentSubscription.dispose();
  }
  async show(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const existing = this.panels.get(jobHistoryPanelKey(environment, jobUrl));
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "jenkinsWorkbench.jobHistory",
      jobHistoryPanelTitle(jobUrl, environment.url),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [getWebviewAssetsRoot(this.extensionUri)]
      }
    );
    this.attach(panel, environment, jobUrl);
  }
  async revive(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    if (
      !isPlainRecord(state) ||
      !isSerializedEnvironmentState(state) ||
      typeof state.jobUrl !== "string"
    ) {
      panel.dispose();
      return;
    }
    const environment = await resolveEnvironmentRef(this.environments, state);
    if (!environment || !parseJobUrl(state.jobUrl, environment.url)) {
      panel.dispose();
      return;
    }
    this.attach(panel, environment, state.jobUrl, state.historyUi);
  }
  /** Reopening panels resolves the current URL and TLS policy from the environment store. */
  private handleEnvironmentChange(change: JenkinsEnvironmentStoreChange): void {
    if (change.kind !== "environment-updated" || (!change.urlChanged && !change.tlsPolicyChanged)) {
      return;
    }
    for (const [key, panel] of [...this.panels]) {
      if (isPanelKeyForEnvironment(key, change.scope, change.environmentId)) {
        panel.dispose();
      }
    }
  }
  private attach(
    panel: vscode.WebviewPanel,
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    ui?: unknown
  ): void {
    const key = jobHistoryPanelKey(environment, jobUrl);
    this.panels.set(key, panel);
    panel.title = jobHistoryPanelTitle(jobUrl, environment.url);
    const controller = new HistoryController(panel, this.dependencies);
    panel.onDidDispose(() => {
      controller.dispose();
      if (this.panels.get(key) === panel) this.panels.delete(key);
    });
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewAssetsRoot(this.extensionUri)]
    };
    const historyUi = normalizeHistoryUi(ui);
    try {
      panel.webview.html = createTypedPanelRenderer("build").renderPanelHtml(
        {},
        {
          ...resolveWebviewAssets(panel.webview, this.extensionUri, "jobHistory"),
          cspSource: panel.webview.cspSource,
          nonce: createNonce(),
          panelState: { ...createSerializedEnvironmentState(environment), jobUrl, historyUi }
        }
      );
    } catch {
      assignWebviewPanelManifestErrorHtml(
        panel,
        this.extensionUri,
        "jobHistory",
        createMissingPanelAssetsMessages({ title: "Job History", panelLabel: "Job History" })
      );
      return;
    }
    controller.restore(historyUi);
    controller.setContext(environment, jobUrl);
  }
}
