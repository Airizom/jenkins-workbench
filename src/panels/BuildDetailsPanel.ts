import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { CoverageDecorationService } from "../services/CoverageDecorationService";
import type { TestSourceNavigationUiService } from "../services/TestSourceNavigationUiService";
import {
  buildTestSourceNavigationContext,
  type TestSourceResolver
} from "../services/TestSourceResolver";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type { PipelineNodeSelection } from "./BuildDetailsPanelLaunchTypes";
import type {
  BuildDetailsBackend,
  BuildDetailsPendingInputProvider
} from "./buildDetails/BuildDetailsBackend";
import {
  getBuildDetailsCoverageDecorationsEnabledConfigKey,
  getBuildDetailsCoverageEnabledConfigKey,
  getTestReportIncludeCaseLogsConfigKey
} from "./buildDetails/BuildDetailsConfig";
import { BuildDetailsMessageRouter } from "./buildDetails/BuildDetailsMessageRouter";
import { BuildDetailsPanelActions } from "./buildDetails/BuildDetailsPanelActions";
import {
  BuildDetailsPanelController,
  type BuildDetailsPanelLoadResult
} from "./buildDetails/BuildDetailsPanelController";
import type { BuildDetailsCanOpenTestSource } from "./buildDetails/BuildDetailsTestSource";
import type { PipelineLogTargetViewModel } from "./buildDetails/shared/BuildDetailsContracts";
import {
  type BuildDetailsPanelSerializedState,
  isBuildDetailsPanelState,
  mergeBuildDetailsPanelState,
  withBuildDetailsPanelUiState
} from "./buildDetails/shared/BuildDetailsPanelWebviewState";
import { disposePanelResources } from "./shared/PanelRuntimeHelpers";
import { getWebviewAssetsRoot } from "./shared/webview/WebviewAssets";
import {
  assignWebviewPanelManifestErrorHtml,
  createPanelRestoreMessages,
  resolveRestoredPanelEnvironment
} from "./shared/webview/WebviewHtml";
import { configureWebviewPanel } from "./shared/webview/WebviewPanelChrome";

interface BuildDetailsPanelShowOptions {
  backend: BuildDetailsBackend;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  coverageDecorationService: CoverageDecorationService;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: BuildDetailsPendingInputProvider | undefined;
  testSourceResolver?: TestSourceResolver;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  extensionUri: vscode.Uri;
  label?: string;
  pipelineNodeSelection?: PipelineNodeSelection;
}

interface BuildDetailsPanelReviveOptions {
  backend: BuildDetailsBackend;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  coverageDecorationService: CoverageDecorationService;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: BuildDetailsPendingInputProvider | undefined;
  testSourceResolver?: TestSourceResolver;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

interface BuildDetailsPanelMutableServices {
  consoleExporter: BuildConsoleExporter;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: BuildDetailsPendingInputProvider | undefined;
  testSourceResolver?: TestSourceResolver;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
}

export class BuildDetailsPanel {
  private static currentPanel: BuildDetailsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private mutableServices!: BuildDetailsPanelMutableServices;
  private readonly controller: BuildDetailsPanelController;
  private readonly actions: BuildDetailsPanelActions;
  private readonly messageRouter: BuildDetailsMessageRouter;
  private readonly disposables: vscode.Disposable[] = [];
  private artifactActionHandler?: ArtifactActionHandler;
  private serializedState?: BuildDetailsPanelSerializedState;
  private readonly canOpenTestSource: BuildDetailsCanOpenTestSource;

  static async show(options: BuildDetailsPanelShowOptions): Promise<void> {
    const {
      backend,
      artifactActionHandler,
      coverageDecorationService,
      environment,
      buildUrl,
      extensionUri,
      label,
      pipelineNodeSelection
    } = options;
    const mutableServices = getMutableServices(options);

    let activePanel = BuildDetailsPanel.currentPanel;
    if (!activePanel) {
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
      configureWebviewPanel(panel, extensionUri, "terminal");
      activePanel = new BuildDetailsPanel(
        panel,
        extensionUri,
        coverageDecorationService,
        mutableServices
      );
      BuildDetailsPanel.currentPanel = activePanel;
    } else {
      activePanel.configure(mutableServices);
    }

    activePanel.panel.reveal(undefined, true);
    await activePanel.load(
      backend,
      artifactActionHandler,
      environment,
      buildUrl,
      label,
      pipelineNodeSelection
    );
  }

  static async revive(
    panel: vscode.WebviewPanel,
    state: unknown,
    options: BuildDetailsPanelReviveOptions
  ): Promise<void> {
    configureWebviewPanel(panel, options.extensionUri, "terminal");
    panel.title = "Build Details";

    const revived = new BuildDetailsPanel(
      panel,
      options.extensionUri,
      options.coverageDecorationService,
      getMutableServices(options)
    );
    BuildDetailsPanel.currentPanel = revived;

    const restored = await resolveRestoredPanelEnvironment({
      panel: revived.panel,
      extensionUri: revived.extensionUri,
      entryName: "buildDetails",
      state,
      isValidState: isBuildDetailsPanelState,
      environmentStore: options.environmentStore,
      messages: createPanelRestoreMessages({
        title: "Build Details",
        viewNoun: "build details view",
        reopenHint: "Open the build again from Jenkins Workbench to continue."
      })
    });
    if (!restored.ok) {
      return;
    }

    revived.serializedState = restored.state;
    await revived.load(
      options.backend,
      options.artifactActionHandler,
      restored.environment,
      restored.state.buildUrl
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coverageDecorationService: CoverageDecorationService,
    mutableServices: BuildDetailsPanelMutableServices
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.canOpenTestSource = (environment, buildUrl, className) =>
      Boolean(
        environment &&
          this.mutableServices.testSourceResolver?.canResolve(
            buildTestSourceNavigationContext(environment, buildUrl),
            className
          )
      );
    this.controller = new BuildDetailsPanelController(
      panel,
      extensionUri,
      coverageDecorationService,
      this.canOpenTestSource
    );
    this.configure(mutableServices);
    this.actions = new BuildDetailsPanelActions({
      controller: this.controller,
      getArtifactActionHandler: () => this.artifactActionHandler,
      getConsoleExporter: () => this.mutableServices.consoleExporter,
      getRefreshHost: () => this.mutableServices.refreshHost,
      getTestSourceNavigationUiService: () => this.mutableServices.testSourceNavigationUiService
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
      onRefreshBuildDetails: () => {
        const details = this.controller.getCurrentDetails();
        void this.controller.refreshBuildDetails({
          label: details?.fullDisplayName ?? details?.displayName,
          panelState: this.serializedState
        });
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
      onSelectPipelineLogNode: (message) => {
        this.actions.handleSelectPipelineLogNode(message);
      },
      onClearPipelineLogNode: () => {
        this.actions.handleClearPipelineLogNode();
      },
      onExportPipelineNodeLog: () => {
        void this.actions.handleExportPipelineNodeLog();
      },
      onReloadTestReport: (message) => {
        void this.actions.handleReloadTestReport(message);
      },
      onOpenTestSource: (message) => {
        void this.actions.handleOpenTestSource(message);
      },
      onPersistUiState: (message) => {
        if (!this.serializedState) {
          return;
        }
        this.serializedState = withBuildDetailsPanelUiState(this.serializedState, message.uiState);
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
        const affectsTestReport = event.affectsConfiguration(
          getTestReportIncludeCaseLogsConfigKey()
        );
        const affectsCoverage =
          event.affectsConfiguration(getBuildDetailsCoverageEnabledConfigKey()) ||
          event.affectsConfiguration(getBuildDetailsCoverageDecorationsEnabledConfigKey());
        if (!affectsTestReport && !affectsCoverage) {
          return;
        }
        if (affectsTestReport) {
          this.controller.updateTestReportOptions();
        }
        if (affectsCoverage) {
          void this.controller.refreshCoverage(this.controller.getLoadToken(), {
            showLoading: true
          });
        }
      })
    );
  }

  private dispose(): void {
    this.controller.dispose();
    BuildDetailsPanel.currentPanel = undefined;
    disposePanelResources(this.disposables);
  }

  private configure(mutableServices: BuildDetailsPanelMutableServices): void {
    this.mutableServices = mutableServices;
    this.controller.setPendingInputProvider(mutableServices.pendingInputProvider);
  }

  private async load(
    backend: BuildDetailsBackend,
    artifactActionHandler: ArtifactActionHandler,
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label?: string,
    pipelineNodeSelection?: PipelineNodeSelection
  ): Promise<void> {
    this.artifactActionHandler = artifactActionHandler;
    let panelState = mergeBuildDetailsPanelState(this.serializedState, environment, buildUrl);
    const pipelineLogTarget = toPipelineLogTargetViewModel(pipelineNodeSelection);
    if (pipelineLogTarget) {
      panelState = withBuildDetailsPanelUiState(panelState, {
        selectedPipelineLogTarget: pipelineLogTarget
      });
    }
    this.serializedState = panelState;
    const result: BuildDetailsPanelLoadResult = await this.controller.load(
      backend,
      environment,
      buildUrl,
      {
        label,
        panelState
      }
    );

    if (result.status === "missingAssets") {
      assignWebviewPanelManifestErrorHtml(this.panel, this.extensionUri, "buildDetails", {
        title: "Build Details",
        message:
          "Build details webview assets are missing. Run the extension build (npm run compile) and try again.",
        hint: "Open the build again from Jenkins Workbench to continue.",
        panelState: panelState ?? this.serializedState
      });
    }
  }
}

function getMutableServices(
  options: BuildDetailsPanelMutableServices
): BuildDetailsPanelMutableServices {
  return {
    consoleExporter: options.consoleExporter,
    refreshHost: options.refreshHost,
    pendingInputProvider: options.pendingInputProvider,
    testSourceResolver: options.testSourceResolver,
    testSourceNavigationUiService: options.testSourceNavigationUiService
  };
}

function toPipelineLogTargetViewModel(
  selection: PipelineNodeSelection | undefined
): PipelineLogTargetViewModel | undefined {
  const nodeId = selection?.nodeId.trim();
  if (!selection || !nodeId) {
    return undefined;
  }
  const name = selection.name?.trim() || (selection.kind === "step" ? "Step" : "Stage");
  return {
    key: `deeplink::${selection.kind}::${nodeId}`,
    kind: selection.kind,
    name,
    nodeId
  };
}
