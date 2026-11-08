import * as vscode from "vscode";
import {
  formatEnvironmentTitle,
  formatJenkinsUrlForDisplay,
  parseHttpUrl
} from "../commands/environment/EnvironmentCommandHelpers";
import type { RecoveryAction } from "../environmentDiagnostics/EnvironmentDiagnosticsContracts";
import { formatEnvironmentDiagnosticsReport } from "../environmentDiagnostics/EnvironmentDiagnosticsReport";
import type { EnvironmentDiagnosticsService } from "../environmentDiagnostics/EnvironmentDiagnosticsService";
import {
  type JenkinsEnvironmentRef,
  toJenkinsEnvironmentRef
} from "../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsEnvironmentStore,
  JenkinsEnvironmentStoreChange
} from "../storage/JenkinsEnvironmentStore";
import { openJenkinsWorkbenchUrl } from "../ui/OpenExternalUrl";
import {
  renderEnvironmentDiagnosticsHtml,
  renderLoadingHtml
} from "./environmentDiagnostics/EnvironmentDiagnosticsRenderer";
import {
  type EnvironmentDiagnosticsViewModel,
  parseEnvironmentDiagnosticsIncomingMessage
} from "./environmentDiagnostics/shared/EnvironmentDiagnosticsPanelMessages";
import { resolvePanelAssetsAndRenderLoading } from "./shared/webview/PanelViewHelpers";
import { createMissingPanelAssetsMessages } from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import { configureWebviewPanel } from "./shared/webview/WebviewPanelChrome";

export interface EnvironmentDiagnosticsPanelOptions {
  extensionUri: vscode.Uri;
  store: JenkinsEnvironmentStore;
  service: Pick<EnvironmentDiagnosticsService, "run">;
  recover: (action: RecoveryAction, environment: JenkinsEnvironmentRef) => Promise<boolean>;
}

export class EnvironmentDiagnosticsPanelLauncher implements vscode.Disposable {
  private readonly panels = new Map<string, EnvironmentDiagnosticsSession>();

  constructor(private readonly options: EnvironmentDiagnosticsPanelOptions) {}

  async show(environment: JenkinsEnvironmentRef): Promise<void> {
    const key = `${environment.scope}:${environment.environmentId}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
      await existing.run();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "jenkinsWorkbench.environmentDiagnostics",
      "Environment Diagnostics",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    const session = new EnvironmentDiagnosticsSession(panel, environment, this.options, () => {
      this.panels.delete(key);
    });
    this.panels.set(key, session);
    await session.run();
  }

  dispose(): void {
    for (const session of this.panels.values()) {
      session.panel.dispose();
    }
    this.panels.clear();
  }
}

class EnvironmentDiagnosticsSession {
  private readonly subscriptions: vscode.Disposable[] = [];
  private model: EnvironmentDiagnosticsViewModel;
  private controller?: AbortController;
  private epoch = 0;
  private disposed = false;
  private dirty = false;
  private recoveryPending = false;
  private assetsAvailable = false;
  private requestTimeoutSeconds: number;

  constructor(
    readonly panel: vscode.WebviewPanel,
    private environment: JenkinsEnvironmentRef,
    private readonly options: EnvironmentDiagnosticsPanelOptions,
    onDisposed: () => void
  ) {
    this.requestTimeoutSeconds = this.readRequestTimeout();
    this.model = {
      revision: 0,
      environmentLabel: formatEnvironmentTitle(environment),
      url: formatJenkinsUrlForDisplay(environment.url),
      scope: environment.scope,
      state: "idle",
      recovering: false
    };
    configureWebviewPanel(panel, options.extensionUri, "server");
    this.updateTitle();
    const nonce = createNonce();
    const assets = resolvePanelAssetsAndRenderLoading({
      panel,
      extensionUri: options.extensionUri,
      entryName: "environmentDiagnostics",
      nonce,
      renderLoadingHtml,
      errorOptions: createMissingPanelAssetsMessages({
        title: "Environment Diagnostics",
        panelLabel: "Environment diagnostics"
      })
    });
    if (assets) {
      this.assetsAvailable = true;
      panel.webview.html = renderEnvironmentDiagnosticsHtml(this.model, {
        ...assets,
        cspSource: panel.webview.cspSource,
        nonce
      });
    }
    this.subscriptions.push(
      panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message).catch(() => {
          this.update({ notice: "The action could not be completed. Try again." });
        });
      }),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.dirty && !this.recoveryPending) {
          void this.run();
        }
      }),
      options.store.onDidChange((change) => {
        void this.handleEnvironmentChange(change).catch(() => {
          this.update({ notice: "Unable to reload the saved environment. Run the checks again." });
        });
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("jenkinsWorkbench.requestTimeoutSeconds")) {
          return;
        }
        const nextTimeout = this.readRequestTimeout();
        if (nextTimeout === this.requestTimeoutSeconds) {
          return;
        }
        this.requestTimeoutSeconds = nextTimeout;
        void this.invalidateConnection("Request timeout setting changed.").catch(() => {
          this.update({ notice: "Unable to reload the saved environment. Run the checks again." });
        });
      }),
      panel.onDidDispose(() => {
        this.disposed = true;
        this.epoch += 1;
        this.controller?.abort();
        for (const subscription of this.subscriptions) {
          subscription.dispose();
        }
        onDisposed();
      })
    );
  }

  async run(): Promise<void> {
    if (
      this.disposed ||
      !this.assetsAvailable ||
      !this.panel.visible ||
      this.model.state === "running" ||
      this.model.state === "removed" ||
      this.recoveryPending
    ) {
      return;
    }
    const epoch = ++this.epoch;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    this.dirty = false;
    this.update({ state: "running", report: undefined, notice: undefined });
    try {
      if (!(await this.reloadEnvironment()) || !this.isCurrent(epoch)) {
        return;
      }
      const report = await this.options.service.run(
        this.environment,
        epoch,
        controller.signal,
        (nextReport) => {
          if (this.isCurrent(epoch)) {
            this.update({ report: nextReport });
          }
        }
      );
      if (this.isCurrent(epoch)) {
        this.update({ state: "completed", report });
      }
    } catch {
      if (this.isCurrent(epoch)) {
        this.update({
          state: controller.signal.aborted ? "cancelled" : "idle",
          notice: controller.signal.aborted
            ? "Checks cancelled. Any completed checks are shown below."
            : "Unable to complete the checks. Run them again."
        });
      }
    }
  }

  private isCurrent(epoch: number): boolean {
    return !this.disposed && epoch === this.epoch;
  }

  private update(patch: Partial<EnvironmentDiagnosticsViewModel>): void {
    if (this.disposed) {
      return;
    }
    this.model = { ...this.model, ...patch, revision: this.model.revision + 1 };
    void this.panel.webview.postMessage({
      type: "updateEnvironmentDiagnostics",
      model: this.model
    });
  }

  private updateTitle(): void {
    this.panel.title = `Environment Diagnostics - ${this.model.environmentLabel}`;
  }

  private cancel(): void {
    if (this.model.state !== "running") {
      return;
    }
    this.epoch += 1;
    this.controller?.abort();
    this.update({
      state: "cancelled",
      notice: "Checks cancelled. Any completed checks are shown below."
    });
  }

  private async reloadEnvironment(expectedEpoch = this.epoch): Promise<boolean> {
    if (this.model.state === "removed") {
      return false;
    }
    const stored = (await this.options.store.getEnvironments(this.environment.scope)).find(
      (entry) => entry.id === this.environment.environmentId
    );
    if (!this.isCurrent(expectedEpoch) || this.isRemoved()) {
      return false;
    }
    if (!stored) {
      this.markRemoved();
      return false;
    }
    this.environment = toJenkinsEnvironmentRef({ ...stored, scope: this.environment.scope });
    this.update({
      environmentLabel: formatEnvironmentTitle(stored),
      url: formatJenkinsUrlForDisplay(stored.url)
    });
    this.updateTitle();
    return true;
  }

  private isRemoved(): boolean {
    return this.model.state === "removed";
  }

  private markRemoved(): void {
    this.epoch += 1;
    this.controller?.abort();
    this.dirty = false;
    this.update({
      state: "removed",
      report: undefined,
      recovering: false,
      notice: "This environment was removed. Add or select an environment to run checks."
    });
  }

  private async handleEnvironmentChange(change: JenkinsEnvironmentStoreChange): Promise<void> {
    if (
      this.disposed ||
      (change.scope !== undefined && change.scope !== this.environment.scope) ||
      (change.kind !== "bulk-update" && change.environmentId !== this.environment.environmentId)
    ) {
      return;
    }
    if (change.kind === "environment-removed") {
      this.markRemoved();
      return;
    }
    if (change.kind === "environment-added") {
      return;
    }
    if (change.kind === "environment-updated" && !change.urlChanged && !change.tlsPolicyChanged) {
      await this.reloadEnvironment();
      return;
    }
    await this.invalidateConnection("Connection settings changed.");
  }

  private readRequestTimeout(): number {
    return vscode.workspace
      .getConfiguration("jenkinsWorkbench")
      .get<number>("requestTimeoutSeconds", 30);
  }

  private async invalidateConnection(notice: string): Promise<void> {
    if (this.disposed || this.isRemoved()) {
      return;
    }
    this.epoch += 1;
    this.controller?.abort();
    this.dirty = true;
    this.update({ state: "idle", report: undefined, notice });
    if (await this.reloadEnvironment()) {
      if (this.panel.visible && !this.recoveryPending) {
        await this.run();
      }
    }
  }

  private async handleMessage(value: unknown): Promise<void> {
    const message = parseEnvironmentDiagnosticsIncomingMessage(value);
    if (!message || this.disposed) {
      return;
    }
    switch (message.type) {
      case "environmentDiagnosticsReady":
        this.update({});
        return;
      case "run":
        await this.run();
        return;
      case "cancel":
        this.cancel();
        return;
      case "copyReport":
        if (this.model.report) {
          await vscode.env.clipboard.writeText(
            formatEnvironmentDiagnosticsReport(this.model.report, {
              name: this.model.environmentLabel,
              url: this.model.url,
              scope: this.model.scope,
              state: this.model.state
            })
          );
        }
        return;
      case "recover":
        await this.recover(message.action);
        return;
    }
  }

  private async recover(action: RecoveryAction): Promise<void> {
    if (this.model.state === "removed" || this.recoveryPending || !this.panel.visible) {
      return;
    }
    if (action === "retry") {
      await this.run();
      return;
    }
    if (action === "openJenkins") {
      if ((await this.reloadEnvironment()) && parseHttpUrl(this.environment.url)) {
        await openJenkinsWorkbenchUrl(this.environment.url, "Environment Diagnostics");
      }
      return;
    }
    if (this.model.state === "running") {
      return;
    }
    if (!this.model.report?.checks.some((check) => check.actions.includes(action))) {
      return;
    }
    if (action === "timeoutSettings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "jenkinsWorkbench.requestTimeoutSeconds"
      );
      return;
    }
    this.recoveryPending = true;
    this.update({ recovering: true, notice: undefined });
    let changed = false;
    try {
      if (!(await this.reloadEnvironment())) {
        return;
      }
      changed = await this.options.recover(action, this.environment);
    } finally {
      this.recoveryPending = false;
      this.update({ recovering: false });
      if (!this.disposed && !this.isRemoved() && (changed || this.dirty)) {
        this.dirty = true;
        await this.run();
      }
    }
  }
}
