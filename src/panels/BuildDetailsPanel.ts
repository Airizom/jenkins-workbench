import * as vscode from "vscode";
import type { BuildDiagnosticsCoordinator } from "../buildDiagnostics/BuildDiagnosticsCoordinator";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails } from "../jenkins/types";
import {
  normalizeJenkinsUrlForComparison,
  parseBuildUrl,
  resolveBuildIdentityForEnvironment
} from "../jenkins/urls";
import type { BuildConsoleExporter } from "../services/BuildConsoleExporter";
import type { BuildManagementWorkflow } from "../services/build/BuildManagementWorkflow";
import type { BuildCompletionTracker } from "../services/buildFollow/BuildCompletionTracker";
import type { BuildFollowUpService } from "../services/buildFollow/BuildFollowUpService";
import type { CoverageDecorationService } from "../services/CoverageDecorationService";
import { pickAndCopyBuildLink } from "../services/links/BuildShareLinks";
import type { TestSourceNavigationUiService } from "../services/TestSourceNavigationUiService";
import {
  buildTestSourceNavigationContext,
  type TestSourceResolver
} from "../services/TestSourceResolver";
import { matchesBuildActionRun } from "../shared/build/BuildCompletionEvidence";
import { isPlainRecord } from "../shared/runtimeGuards";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { ArtifactActionHandler } from "../ui/ArtifactActionHandler";
import type {
  BuildDetailsPanelLaunchRequest,
  PipelineNodeSelection
} from "./BuildDetailsPanelLauncher";
import type {
  BuildDetailsBackend,
  BuildDetailsPendingInputProvider
} from "./buildDetails/BuildDetailsBackend";
import {
  getBuildDetailsCoverageDecorationsEnabledConfigKey,
  getBuildDetailsCoverageEnabledConfigKey,
  getTestReportIncludeCaseLogsConfigKey
} from "./buildDetails/BuildDetailsConfig";
import { formatError } from "./buildDetails/BuildDetailsFormatters";
import { createBuildDetailsMessageRouter } from "./buildDetails/BuildDetailsMessageBindings";
import type { BuildDetailsMessageRouter } from "./buildDetails/BuildDetailsMessageRouter";
import {
  BuildDetailsNavigation,
  type BuildDetailsNavigationTarget
} from "./buildDetails/BuildDetailsNavigation";
import { BuildDetailsPanelActions } from "./buildDetails/BuildDetailsPanelActions";
import {
  BuildDetailsPanelController,
  type BuildDetailsPanelLoadResult
} from "./buildDetails/BuildDetailsPanelController";
import { readPanelBuildDetails } from "./buildDetails/BuildDetailsPanelState";
import { resolveDisplayedRun } from "./buildDetails/BuildDetailsRunIdentity";
import type { BuildDetailsCanOpenTestSource } from "./buildDetails/BuildDetailsTestSource";
import type { PipelineLogTargetViewModel } from "./buildDetails/shared/BuildDetailsContracts";
import {
  type BuildDetailsPanelSerializedState,
  isBuildDetailsPanelState,
  mergeBuildDetailsPanelState,
  withBuildDetailsPanelUiState
} from "./buildDetails/shared/BuildDetailsPanelWebviewState";
import { HistoryController, type HistoryDependencies } from "./jobHistory/HistoryController";
import { normalizeHistoryUi } from "./jobHistory/shared/HistoryContracts";
import { disposePanelResources } from "./shared/PanelRuntimeHelpers";
import { getWebviewAssetsRoot } from "./shared/webview/WebviewAssets";
import {
  assignWebviewPanelManifestErrorHtml,
  createMissingPanelAssetsMessages,
  createPanelRestoreMessages,
  resolveRestoredPanelEnvironment
} from "./shared/webview/WebviewHtml";
import { configureWebviewPanel } from "./shared/webview/WebviewPanelChrome";

export interface BuildDetailsPanelServices {
  historyDependencies?: HistoryDependencies;
  backend: BuildDetailsBackend;
  artifactActionHandler: ArtifactActionHandler;
  consoleExporter: BuildConsoleExporter;
  coverageDecorationService: CoverageDecorationService;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: BuildDetailsPendingInputProvider | undefined;
  testSourceResolver?: TestSourceResolver;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
  buildDiagnosticsCoordinator: BuildDiagnosticsCoordinator;
  completionTracker: BuildCompletionTracker;
  /** Usually a lazy container reference, resolved on the first keep/edit/delete request. */
  buildManagementWorkflow?: BuildManagementWorkflow;
  /** Usually a lazy container reference, resolved on the first restart from stage. */
  buildFollowUp?: BuildFollowUpService;
}

interface BuildDetailsPanelShowOptions
  extends BuildDetailsPanelServices,
    BuildDetailsPanelLaunchRequest {
  environmentStore: Pick<JenkinsEnvironmentStore, "isCurrentController">;
  extensionUri: vscode.Uri;
}

interface BuildDetailsPanelReviveOptions extends BuildDetailsPanelServices {
  environmentStore: JenkinsEnvironmentStore;
  extensionUri: vscode.Uri;
}

export interface BuildDetailsPanelBuildContext {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
  pipelineNode?: PipelineNodeSelection;
}

/** Reads the open Build Details build without constructing the panel launcher and its services. */
export interface BuildDetailsCurrentBuildProvider {
  getCurrentBuild(): BuildDetailsPanelBuildContext | undefined;
}

export const buildDetailsCurrentBuildProvider: BuildDetailsCurrentBuildProvider = {
  getCurrentBuild: () => BuildDetailsPanel.getCurrentBuildContext()
};

interface BuildDetailsPanelMutableServices {
  consoleExporter: BuildConsoleExporter;
  refreshHost: EnvironmentScopedRefreshHost | undefined;
  pendingInputProvider: BuildDetailsPendingInputProvider | undefined;
  testSourceResolver?: TestSourceResolver;
  testSourceNavigationUiService?: TestSourceNavigationUiService;
  buildManagementWorkflow?: BuildManagementWorkflow;
  buildFollowUp?: BuildFollowUpService;
}

export class BuildDetailsPanel {
  private readonly historyController?: HistoryController;
  private historyEnvironment?: JenkinsEnvironmentRef;
  private historyBuildUrl?: string;
  private static currentPanel: BuildDetailsPanel | undefined;
  private static showGeneration = 0;
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
  private readonly navigation = new BuildDetailsNavigation();
  private navigationGeneration = 0;
  private navigationBusy = false;
  private currentLoadComplete = false;
  private disposed = false;

  static async show(options: BuildDetailsPanelShowOptions): Promise<void> {
    const { backend, artifactActionHandler, environment, buildUrl, label, pipelineNodeSelection } =
      options;
    const mutableServices = getMutableServices(options);

    let activePanel = BuildDetailsPanel.currentPanel;
    const generation = ++BuildDetailsPanel.showGeneration;
    let initialDetails: JenkinsBuildDetails | undefined;
    if (options.expectedRun) {
      const navigation = activePanel?.navigationGeneration;
      const loadToken = activePanel?.controller.getLoadToken();
      const current = () =>
        generation === BuildDetailsPanel.showGeneration &&
        activePanel === BuildDetailsPanel.currentPanel &&
        activePanel?.navigationGeneration === navigation &&
        activePanel?.controller.getLoadToken() === loadToken;
      const controllerMatches = () =>
        options.environmentStore.isCurrentController(
          environment.scope,
          environment.environmentId,
          environment.url
        );
      const warn = () =>
        void vscode.window.showWarningMessage(
          `Unable to open ${label ?? "build details"}: Jenkins could not confirm the selected run at its numbered URL.`
        );
      if (!controllerMatches()) {
        warn();
        return;
      }
      try {
        initialDetails = await readPanelBuildDetails(() =>
          backend.status.getBuildDetails(environment, buildUrl, {
            includeCauses: true,
            bypassCache: true
          })
        );
      } catch {
        if (current()) warn();
        return;
      }
      if (!current()) return;
      if (!controllerMatches() || !matchesBuildActionRun(options.expectedRun, initialDetails)) {
        warn();
        return;
      }
    }
    activePanel = BuildDetailsPanel.openPanel(activePanel, options, mutableServices);
    activePanel.panel.reveal(undefined, true);
    await activePanel.load(
      backend,
      artifactActionHandler,
      environment,
      buildUrl,
      label,
      pipelineNodeSelection,
      initialDetails ? { initialDetails, verifiedSelection: true } : undefined
    );
  }

  private static openPanel(
    activePanel: BuildDetailsPanel | undefined,
    options: BuildDetailsPanelShowOptions,
    mutableServices: BuildDetailsPanelMutableServices
  ): BuildDetailsPanel {
    if (activePanel) {
      activePanel.configure(mutableServices);
      return activePanel;
    }
    const { extensionUri, coverageDecorationService } = options;
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
    const opened = new BuildDetailsPanel(
      panel,
      extensionUri,
      coverageDecorationService,
      mutableServices,
      options.buildDiagnosticsCoordinator,
      options.completionTracker,
      options.historyDependencies
    );
    BuildDetailsPanel.currentPanel = opened;
    return opened;
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
      getMutableServices(options),
      options.buildDiagnosticsCoordinator,
      options.completionTracker,
      options.historyDependencies
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

  /** The build shown in the open panel, or undefined when no build is loaded. */
  static getCurrentBuildContext(): BuildDetailsPanelBuildContext | undefined {
    return BuildDetailsPanel.currentPanel?.getBuildContext();
  }

  /** Closes the panel when it shows the given environment, e.g. after its URL changed. */
  static closeForEnvironment(scope: JenkinsEnvironmentRef["scope"], environmentId: string): void {
    const current = BuildDetailsPanel.currentPanel;
    if (!current) {
      return;
    }
    const environment = current.controller.getEnvironment() ?? current.historyEnvironment;
    if (environment?.scope === scope && environment.environmentId === environmentId) {
      current.panel.dispose();
    }
  }

  /** Closes the panel when it shows the given build, e.g. after the build was deleted. */
  static closeForBuild(
    scope: JenkinsEnvironmentRef["scope"],
    environmentId: string,
    buildUrl: string
  ): void {
    const current = BuildDetailsPanel.currentPanel;
    if (!current) {
      return;
    }
    const environment = current.controller.getEnvironment();
    const currentBuildUrl = current.controller.getBuildUrl();
    if (
      environment?.scope === scope &&
      environment.environmentId === environmentId &&
      currentBuildUrl &&
      matchesDeletedBuild(environment.url, currentBuildUrl, buildUrl)
    ) {
      current.panel.dispose();
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    coverageDecorationService: CoverageDecorationService,
    mutableServices: BuildDetailsPanelMutableServices,
    private readonly buildDiagnosticsCoordinator: BuildDiagnosticsCoordinator,
    completionTracker: BuildCompletionTracker,
    historyDependencies?: HistoryDependencies
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.historyController = historyDependencies
      ? new HistoryController(panel, historyDependencies)
      : undefined;
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
      this.canOpenTestSource,
      (details) => {
        this.buildDiagnosticsCoordinator.updatePanelBuildStatus(
          details,
          this.controller.getBuildUrl()
        );
        this.updateHistory();
        this.recordRecoveredNavigation();
        this.actions.postBuildFollowState("details");
      },
      () => this.postCurrentBuildDiagnostics(),
      () => this.mutableServices.testSourceResolver?.whenReady() ?? Promise.resolve(),
      () => this.updateHistory(),
      completionTracker
    );
    this.configure(mutableServices);
    this.actions = new BuildDetailsPanelActions({
      completionTracker,
      controller: this.controller,
      getArtifactActionHandler: () => this.artifactActionHandler,
      getConsoleExporter: () => this.mutableServices.consoleExporter,
      getRefreshHost: () => this.mutableServices.refreshHost,
      getTestSourceNavigationUiService: () => this.mutableServices.testSourceNavigationUiService,
      getBuildManagementWorkflow: () => this.mutableServices.buildManagementWorkflow,
      getBuildFollowUp: () => this.mutableServices.buildFollowUp
    });
    this.messageRouter = createBuildDetailsMessageRouter({
      actions: this.actions,
      controller: this.controller,
      buildDiagnosticsCoordinator: this.buildDiagnosticsCoordinator,
      getSerializedState: () => this.serializedState,
      onBuildDetailsReady: () => {
        this.actions.postBuildFollowState();
        this.postNavigation();
        this.controller.republishRelationships();
      },
      openRelatedBuild: (targetId) => {
        const target = this.controller.getRelatedBuildTarget(targetId);
        if (target) {
          void this.navigateToBuild(target.buildUrl, `${target.jobName} #${target.number}`);
        }
      },
      copyBuildLink: () => {
        void this.copyBuildLink().catch((error: unknown) => {
          void vscode.window.showErrorMessage(`Unable to copy link: ${formatActionError(error)}`);
        });
      },
      navigateBuild: (direction) => {
        this.recordDisplayedNavigation();
        const target = this.navigation.target(direction);
        if (target) {
          void this.navigateToBuild(target.entry.buildUrl, target.entry.label, target);
        }
      },
      persistUiState: (message) => {
        if (this.serializedState) {
          this.serializedState = withBuildDetailsPanelUiState(
            this.serializedState,
            message.uiState
          );
        }
      }
    });

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel.visible) {
          this.actions.postBuildFollowState();
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
        if (isPlainRecord(message) && message.type === "persistHistoryUi" && this.serializedState) {
          this.serializedState.historyUi = normalizeHistoryUi(message.uiState);
          return;
        }
        this.messageRouter.route(message);
      },
      null,
      this.disposables
    );
    this.disposables.push(
      completionTracker.onDidChange(() => this.actions.postBuildFollowState()),
      this.buildDiagnosticsCoordinator.onDidChange((event) => {
        const buildUrl = this.controller.getBuildUrl();
        if (!buildUrl || (event.buildUrl && !areBuildUrlsEqual(event.buildUrl, buildUrl))) {
          return;
        }
        this.postCurrentBuildDiagnostics();
      }),
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
    this.disposed = true;
    this.navigationGeneration++;
    this.historyController?.dispose();
    const buildUrl = this.controller.getBuildUrl();
    disposePanelResources(this.disposables);
    this.controller.dispose();
    BuildDetailsPanel.currentPanel = undefined;
    this.buildDiagnosticsCoordinator.clearPanelOwner(buildUrl);
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
    pipelineNodeSelection?: PipelineNodeSelection,
    navigationLoad?: {
      generation?: number;
      verifiedSelection?: true;
      target?: BuildDetailsNavigationTarget;
      initialDetails: JenkinsBuildDetails;
    }
  ): Promise<void> {
    const generation = navigationLoad?.generation ?? ++this.navigationGeneration;
    if (this.disposed || generation !== this.navigationGeneration) {
      return;
    }
    this.currentLoadComplete = false;
    if (navigationLoad?.generation === undefined) {
      this.navigationBusy = false;
    }
    this.navigation.snapshot(this.serializedState);
    this.navigation.setEnvironment(environment);
    this.historyController?.clear();
    this.historyEnvironment = environment;
    this.historyBuildUrl = undefined;
    this.artifactActionHandler = artifactActionHandler;
    this.buildDiagnosticsCoordinator.setPanelOwner(environment, buildUrl);
    let panelState = mergeBuildDetailsPanelState(
      navigationLoad?.target?.entry.panelState ?? this.serializedState,
      environment,
      buildUrl
    );
    const pipelineLogTarget = toPipelineLogTargetViewModel(pipelineNodeSelection);
    if (pipelineLogTarget) {
      panelState = withBuildDetailsPanelUiState(panelState, {
        selectedPipelineLogTarget: pipelineLogTarget
      });
    }
    this.serializedState = panelState;
    this.historyController?.restore(normalizeHistoryUi(panelState.historyUi));
    const result: BuildDetailsPanelLoadResult = await this.controller.load(
      backend,
      environment,
      buildUrl,
      {
        label,
        panelState,
        initialDetails: navigationLoad?.initialDetails,
        ...(navigationLoad?.verifiedSelection && { verifiedSelection: true })
      }
    );

    if (this.disposed || generation !== this.navigationGeneration) {
      return;
    }
    if (result.status === "missingAssets") {
      assignWebviewPanelManifestErrorHtml(this.panel, this.extensionUri, "buildDetails", {
        ...createMissingPanelAssetsMessages({
          title: "Build Details",
          panelLabel: "Build Details"
        }),
        panelState: panelState ?? this.serializedState
      });
      return;
    }
    this.recordLoadedNavigation(environment, buildUrl, label, navigationLoad?.target);
    this.currentLoadComplete = true;
    this.postNavigation();
    this.postCurrentBuildDiagnostics();
    this.updateHistory();
  }

  private recordLoadedNavigation(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label: string | undefined,
    target: BuildDetailsNavigationTarget | undefined
  ): void {
    const details = this.controller.getCurrentDetails();
    const currentBuildUrl = this.controller.getBuildUrl();
    if (details && currentBuildUrl && areBuildUrlsEqual(currentBuildUrl, buildUrl)) {
      const entry = {
        environment,
        buildUrl,
        label: details.fullDisplayName ?? details.displayName ?? label,
        panelState: this.serializedState
      };
      if (target) {
        this.navigation.commit(target, entry);
      } else {
        this.navigation.record(entry);
      }
    }
  }

  private getBuildContext(): BuildDetailsPanelBuildContext | undefined {
    if (this.disposed) {
      return undefined;
    }
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    if (!environment || !buildUrl) {
      return undefined;
    }
    const details = this.controller.getCurrentDetails();
    let sharedUrl: string | undefined;
    if (details) {
      sharedUrl = resolveDisplayedRun(environment, buildUrl, details, "share")?.buildUrl;
    } else {
      const onController = normalizeJenkinsUrlForComparison(buildUrl, environment.url).startsWith(
        normalizeJenkinsUrlForComparison(environment.url)
      );
      sharedUrl = resolveBuildIdentityForEnvironment(
        environment.url,
        buildUrl,
        "share",
        undefined,
        onController ? "configured" : "reported"
      )?.buildUrl;
    }
    if (!sharedUrl) return undefined;
    return {
      environment,
      buildUrl: sharedUrl,
      label: details?.fullDisplayName ?? details?.displayName,
      pipelineNode: toPipelineNodeSelection(this.controller.getCurrentPipelineNodeLog()?.target)
    };
  }

  private async copyBuildLink(): Promise<void> {
    const context = this.getBuildContext();
    if (!context) {
      return;
    }
    await pickAndCopyBuildLink({
      kind: "build",
      url: context.buildUrl,
      environmentUrl: context.environment.url,
      node: context.pipelineNode
    });
  }

  private recordRecoveredNavigation(): void {
    if (this.disposed || !this.currentLoadComplete) {
      return;
    }
    this.recordDisplayedNavigation();
  }

  private recordDisplayedNavigation(): void {
    if (this.disposed) return;
    const details = this.controller.getCurrentDetails();
    const environment = this.controller.getEnvironment();
    const buildUrl = this.controller.getBuildUrl();
    const panelState = this.serializedState;
    if (
      !details ||
      !environment ||
      !buildUrl ||
      !areBuildUrlsEqual(details.url, buildUrl) ||
      !panelState ||
      panelState.environmentId !== environment.environmentId ||
      panelState.scope !== environment.scope ||
      !areBuildUrlsEqual(panelState.buildUrl, buildUrl)
    ) {
      return;
    }
    // Details can already be visible while test/coverage activation is still pending.
    // Save that successful source before navigation invalidates the pending load.
    this.navigation.record({
      environment,
      buildUrl,
      label: details.fullDisplayName ?? details.displayName,
      panelState
    });
    this.postNavigation();
  }

  private async navigateToBuild(
    buildUrl: string,
    label?: string,
    target?: BuildDetailsNavigationTarget
  ): Promise<void> {
    const backend = this.controller.getBackend();
    const environment = this.controller.getEnvironment();
    const artifactActionHandler = this.artifactActionHandler;
    const sourceBuildUrl = this.controller.getBuildUrl();
    if (
      this.disposed ||
      this.navigationBusy ||
      !backend ||
      !environment ||
      !artifactActionHandler ||
      !sourceBuildUrl ||
      areBuildUrlsEqual(sourceBuildUrl, buildUrl)
    ) {
      return;
    }
    this.recordDisplayedNavigation();
    const generation = ++this.navigationGeneration;
    const sourceToken = this.controller.getLoadToken();
    this.navigationBusy = true;
    this.postNavigation();
    try {
      // Validate access before replacing the current webview. Reuse these details
      // in the load so an unavailable target cannot clear the source build.
      const initialDetails = await readPanelBuildDetails(() =>
        backend.status.getBuildDetails(environment, buildUrl, {
          includeCauses: true,
          bypassCache: true
        })
      );
      if (
        this.disposed ||
        generation !== this.navigationGeneration ||
        sourceToken !== this.controller.getLoadToken()
      ) {
        return;
      }
      await this.load(backend, artifactActionHandler, environment, buildUrl, label, undefined, {
        generation,
        target,
        initialDetails
      });
    } catch (error) {
      if (
        !this.disposed &&
        generation === this.navigationGeneration &&
        sourceToken === this.controller.getLoadToken()
      ) {
        void vscode.window.showErrorMessage(
          `Unable to open ${label ?? "related build"}: ${formatError(error)}. Check that the build still exists and that you have permission to view it.`
        );
      }
    } finally {
      if (!this.disposed && generation === this.navigationGeneration) {
        this.navigationBusy = false;
        this.postNavigation();
      }
    }
  }

  private postNavigation(): void {
    this.controller.postMessage({
      type: "setBuildNavigation",
      navigation: {
        canGoBack: this.navigation.canGoBack,
        canGoForward: this.navigation.canGoForward,
        busy: this.navigationBusy
      }
    });
  }

  private updateHistory(): void {
    const details = this.controller.getCurrentDetails();
    const buildUrl = this.controller.getBuildUrl();
    const jobUrl = buildUrl
      ? parseBuildUrl(buildUrl, this.historyEnvironment?.url)?.jobUrl
      : undefined;
    const hasFailures = this.controller.hasFailedTests();
    const historyKey = `${buildUrl}:${hasFailures}`;
    if (
      !details ||
      details.building ||
      !jobUrl ||
      !this.historyEnvironment ||
      this.historyBuildUrl === historyKey
    )
      return;
    this.historyBuildUrl = historyKey;
    this.historyController?.setContext(this.historyEnvironment, jobUrl, details, hasFailures);
  }

  private postCurrentBuildDiagnostics(): void {
    const buildUrl = this.controller.getBuildUrl();
    if (!buildUrl) {
      return;
    }
    this.controller.postBuildDiagnostics(
      this.buildDiagnosticsCoordinator.getDiagnostics(
        buildUrl,
        this.controller.getDiagnosticConsoleText()
      )
    );
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
    testSourceNavigationUiService: options.testSourceNavigationUiService,
    buildManagementWorkflow: options.buildManagementWorkflow,
    buildFollowUp: options.buildFollowUp
  };
}

/** Both restored panels and verified mutation endpoints can use an internal Jenkins URL. */
function matchesDeletedBuild(
  environmentUrl: string,
  panelUrl: string,
  deletedUrl: string
): boolean {
  const base = normalizeJenkinsUrlForComparison(environmentUrl);
  const identity = (url: string) => {
    const endpoint = normalizeJenkinsUrlForComparison(url, environmentUrl);
    return (
      resolveBuildIdentityForEnvironment(
        environmentUrl,
        endpoint,
        "comparison",
        undefined,
        endpoint.startsWith(base) ? "configured" : "reported"
      )?.buildUrl ?? endpoint
    );
  };
  return identity(deletedUrl) === identity(panelUrl);
}

function areBuildUrlsEqual(left: string, right: string): boolean {
  return normalizeJenkinsUrlForComparison(left) === normalizeJenkinsUrlForComparison(right);
}

export function toPipelineLogTargetViewModel(
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

/** Inverse of toPipelineLogTargetViewModel; aggregated targets without a node id have no selection. */
export function toPipelineNodeSelection(
  target: PipelineLogTargetViewModel | undefined
): PipelineNodeSelection | undefined {
  const nodeId = target?.nodeId?.trim();
  if (!target || !nodeId) {
    return undefined;
  }
  const name = target.name.trim();
  return name ? { kind: target.kind, nodeId, name } : { kind: target.kind, nodeId };
}
