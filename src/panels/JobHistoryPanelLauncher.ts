import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash, parseJobUrl } from "../jenkins/urls";
import { isPlainRecord } from "../shared/runtimeGuards";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { HistoryController, type HistoryDependencies } from "./jobHistory/HistoryController";
import { normalizeHistoryUi } from "./jobHistory/shared/HistoryContracts";
import { getWebviewAssetsRoot, resolveWebviewAssets } from "./shared/webview/WebviewAssets";
import {
  assignWebviewPanelManifestErrorHtml,
  createTypedPanelRenderer
} from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import {
  createSerializedEnvironmentState,
  isSerializedEnvironmentState,
  resolveEnvironmentRef
} from "./shared/webview/WebviewPanelState";

export class JobHistoryPanelLauncher {
  private panels = new Map<string, vscode.WebviewPanel>();
  constructor(
    private readonly dependencies: HistoryDependencies,
    private readonly extensionUri: vscode.Uri,
    private readonly environments: JenkinsEnvironmentStore
  ) {}
  async show(environment: JenkinsEnvironmentRef, jobUrl: string): Promise<void> {
    const key = JSON.stringify([
      environment.scope,
      environment.environmentId,
      ensureTrailingSlash(jobUrl)
    ]);
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "jenkinsWorkbench.jobHistory",
      "Job History",
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
      typeof state.jobUrl !== "string" ||
      !parseJobUrl(state.jobUrl)
    ) {
      panel.dispose();
      return;
    }
    const environment = await resolveEnvironmentRef(this.environments, state);
    if (!environment) {
      panel.dispose();
      return;
    }
    this.attach(panel, environment, state.jobUrl, state.historyUi);
  }
  private attach(
    panel: vscode.WebviewPanel,
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    ui?: unknown
  ): void {
    const key = JSON.stringify([
      environment.scope,
      environment.environmentId,
      ensureTrailingSlash(jobUrl)
    ]);
    this.panels.set(key, panel);
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
      assignWebviewPanelManifestErrorHtml(panel, this.extensionUri, "jobHistory", {
        title: "Job History",
        message: "Job History assets are missing. Run npm run compile.",
        hint: "Reopen Job History after compiling."
      });
      return;
    }
    controller.restore(historyUi);
    controller.setContext(environment, jobUrl);
  }
}
