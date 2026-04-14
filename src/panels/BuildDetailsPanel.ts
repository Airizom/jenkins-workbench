import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { TestSourceNavigationService } from "../services/TestSourceNavigationService";
import type { TestSourceNavigationUiService } from "../services/TestSourceNavigationUiService";
import { buildTestSourceNavigationContext } from "../services/TestSourceResolver";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import { getTestReportIncludeCaseLogsConfigKey } from "./buildDetails/BuildDetailsConfig";
import { BuildDetailsMessageRouter } from "./buildDetails/BuildDetailsMessageRouter";
import { BuildDetailsPanelActions } from "./buildDetails/BuildDetailsPanelActions";
import {
  BuildDetailsPanelController,
  type BuildDetailsPanelLoadResult
} from "./buildDetails/BuildDetailsPanelController";
import type {
  BuildDetailsDataService,
  PendingInputActionProvider
} from "./buildDetails/BuildDetailsPollingController";
import type { BuildDetailsCanOpenTestSource } from "./buildDetails/BuildDetailsTestSource";
import { getWebviewAssetsRoot, resolveWebviewAssets } from "./shared/webview/WebviewAssets";
import { renderPanelRestoreErrorHtml } from "./shared/webview/WebviewHtml";
import { createNonce } from "./shared/webview/WebviewNonce";
import {
  type SerializedEnvironmentState,
  isSerializedEnvironmentState,
  resolveEnvironmentRef
} from "./shared/webview/WebviewPanelState";

interface BuildDetailsPanelSerializedState extends SerializedEnvironmentState {
  buildUrl: string;
}

interface BuildDetailsPanelShowOptions {
  dataService: BuildDetailsDataService;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: PendingInputActionProvider | undefined;
  testSourceNavigationService?: TestSourceNavigationService;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  extensionUri: vscode.Uri;
  label?: string;
}

interface BuildDetailsPanelReviveOptions {
  dataService: BuildDetailsDataService;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: PendingInputActionProvider | undefined;
  testSourceNavigationService?: TestSourceNavigationService;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

function isBuildDetailsPanelState(value: unknown): value is BuildDetailsPanelSerializedState {
  if (!isSerializedEnvironmentState(value)) {
    return false;
  }
  const record = value as { buildUrl?: unknown };
  return typeof record.buildUrl === "string" && record.buildUrl.length > 0;
}

function createBuildDetailsPanelState(
  environment: JenkinsEnvironmentRef,
  buildUrl: string
): BuildDetailsPanelSerializedState {
  return {
    environmentId: environment.environmentId,
    scope: environment.scope,
    buildUrl
  };
}

export class BuildDetailsPanel {
  private static currentPanel: BuildDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private consoleExporter: BuildConsoleExporter;
  private readonly controller: BuildDetailsPanelController;
  private readonly actions: BuildDetailsPanelActions;
  private readonly messageRouter: BuildDetailsMessageRouter;
  private readonly disposables: vscode.Disposable[] = [];
  private artifactActionHandler?: ArtifactActionHandler;
  private refreshHost?: EnvironmentScopedRefreshHost;
  private testSourceNavigationService?: TestSourceNavigationService;
  private testSourceNavigationUiService?: TestSourceNavigationUiService;
  private readonly canOpenTestSource: BuildDetailsCanOpenTestSource;

  static async show(options: BuildDetailsPanelShowOptions): Promise<void> {
    const {
      dataService,
      artifactActionHandler,
      consoleExporter,
      refreshHost,
      pendingInputProvider,
      testSourceNavigationService,
      testSourceNavigationUiService,
      environment,
      buildUrl,
      extensionUri,
      label
    } = options;

    if (!BuildDetailsPanel.currentPanel) {
      const panel = vscode.window.createWebviewPanel(
        "jenkinsWorkbench.buildDetails",
        "Build Details",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
        }
      );
      BuildDetailsPanel.configurePanel(panel, extensionUri);
      BuildDetailsPanel.currentPanel = new BuildDetailsPanel(
        panel,
        extensionUri,
        consoleExporter,
        testSourceNavigationService,
        testSourceNavigationUiService
      );
    }

    const activePanel = BuildDetailsPanel.currentPanel;
    activePanel.configure(
      consoleExporter,
      refreshHost,
      pendingInputProvider,
      testSourceNavigationService,
      testSourceNavigationUiService
    );
    activePanel.panel.reveal(undefined, true);
    await activePanel.load(dataService, artifactActionHandler, environment, buildUrl, label);
  }

  static async revive(
    panel: vscode.WebviewPanel,
    state: unknown,
    options: BuildDetailsPanelReviveOptions
  ): Promise<void> {
    BuildDetailsPanel.configurePanel(panel, options.extensionUri);
    panel.title = "Build Details";

    const revived = new BuildDetailsPanel(
      panel,
      options.extensionUri,
      options.consoleExporter,
      options.testSourceNavigationService,
      options.testSourceNavigationUiService
    );
    BuildDetailsPanel.currentPanel = revived;
    revived.configure(
      options.consoleExporter,
      options.refreshHost,
      options.pendingInputProvider,
      options.testSourceNavigationService,
      options.testSourceNavigationUiService
    );

    if (!isBuildDetailsPanelState(state)) {
      revived.renderRestoreError(
        "This build details view could not be restored. Reopen it from Jenkins Workbench."
      );
      return;
    }

    const environment = await resolveEnvironmentRef(options.environmentStore, state);
    if (!environment) {
      revived.renderRestoreError(
        "This build details view could not be restored because its Jenkins environment was removed.",
        state
      );
      return;
    }

    await revived.load(
      options.dataService,
      options.artifactActionHandler,
      environment,
      state.buildUrl
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    consoleExporter: BuildConsoleExporter,
    testSourceNavigationService?: TestSourceNavigationService,
    testSourceNavigationUiService?: TestSourceNavigationUiService
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.consoleExporter = consoleExporter;
    this.testSourceNavigationService = testSourceNavigationService;
    this.testSourceNavigationUiService = testSourceNavigationUiService;
    this.canOpenTestSource = (environment, buildUrl, className) =>
      Boolean(
        environment &&
          this.testSourceNavigationService?.canNavigate(
            buildTestSourceNavigationContext(environment, buildUrl),
            className
          )
      );
    this.controller = new BuildDetailsPanelController(panel, extensionUri, this.canOpenTestSource);
    this.actions = new BuildDetailsPanelActions({
      controller: this.controller,
      getArtifactActionHandler: () => this.artifactActionHandler,
      getConsoleExporter: () => this.consoleExporter,
      getRefreshHost: () => this.refreshHost,
      getTestSourceNavigationUiService: () => this.testSourceNavigationUiService
    });
    this.messageRouter = new BuildDetailsMessageRouter({
      onArtifactAction: (message) => {
        void this.actions.handleArtifactAction(message);
      },
      onOpenExternal: (url) => {
        void this.actions.openExternalUrl(url);
      },
      onExportConsole: () => {
        void this.actions.handleExportConsole();
      },
      onApproveInput: (message) => {
        void this.actions.handleApproveInput(message);
      },
      onRejectInput: (message) => {
        void this.actions.handleRejectInput(message);
      },
      onRestartPipelineFromStage: (message) => {
        void this.actions.handleRestartPipelineFromStage(message);
      },
      onReloadTestReport: (message) => {
        void this.actions.handleReloadTestReport(message);
      },
      onOpenTestSource: (message) => {
        void this.actions.handleOpenTestSource(message);
      },
      onToggleFollowLog: (value) => {
        this.controller.setFollowLog(Boolean(value));
      }
    });

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          void this.controller.handlePanelVisible();
        } else {
          this.controller.handlePanelHidden();
        }
      },
      null,
      this.disposables
    );
    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        this.messageRouter.route(message);
      },
      null,
      this.disposables
    );
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(getTestReportIncludeCaseLogsConfigKey())) {
          return;
        }
        this.controller.updateTestReportOptions();
      })
    );
  }

  private dispose(): void {
    this.controller.dispose();
    BuildDetailsPanel.currentPanel = undefined;
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private configure(
    consoleExporter: BuildConsoleExporter,
    refreshHost: EnvironmentScopedRefreshHost | undefined,
    pendingInputProvider: PendingInputActionProvider | undefined,
    testSourceNavigationService?: TestSourceNavigationService,
    testSourceNavigationUiService?: TestSourceNavigationUiService
  ): void {
    this.consoleExporter = consoleExporter;
    this.refreshHost = refreshHost;
    this.testSourceNavigationService = testSourceNavigationService;
    this.testSourceNavigationUiService = testSourceNavigationUiService;
    this.controller.setPendingInputProvider(pendingInputProvider);
  }

  private async load(
    dataService: BuildDetailsDataService,
    artifactActionHandler: ArtifactActionHandler,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label?: string
  ): Promise<void> {
    this.artifactActionHandler = artifactActionHandler;
    const panelState = createBuildDetailsPanelState(environment, buildUrl);
    const result: BuildDetailsPanelLoadResult = await this.controller.load(
      dataService,
      environment,
      buildUrl,
      {
        label,
        panelState
      }
    );

    if (result.status === "missingAssets") {
      this.renderRestoreError(
        "Build details webview assets are missing. Run the extension build (npm run compile) and try again.",
        panelState
      );
    }
  }

  private static configurePanel(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [getWebviewAssetsRoot(extensionUri)]
    };
    panel.iconPath = BuildDetailsPanel.getIconPaths(extensionUri);
  }

  private static getIconPaths(extensionUri: vscode.Uri): { light: vscode.Uri; dark: vscode.Uri } {
    const lightIconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "codicons",
      "terminal-light.svg"
    );
    const darkIconPath = vscode.Uri.joinPath(
      extensionUri,
      "resources",
      "codicons",
      "terminal-dark.svg"
    );
    return { light: lightIconPath, dark: darkIconPath };
  }

  private renderRestoreError(message: string, panelState?: BuildDetailsPanelSerializedState): void {
    const nonce = createNonce();
    let styleUris: string[] = [];
    try {
      styleUris = resolveWebviewAssets(
        this.panel.webview,
        this.extensionUri,
        "buildDetails"
      ).styleUris;
    } catch {
      // keep empty
    }
    this.panel.webview.html = renderPanelRestoreErrorHtml(this.panel.webview.cspSource, {
      nonce,
      title: "Build Details",
      message,
      hint: "Open the build again from Jenkins Workbench to continue.",
      styleUris,
      panelState
    });
  }
}
