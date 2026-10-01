import type * as vscode from "vscode";
import { BuildDiagnosticsCoordinator } from "../../buildDiagnostics/BuildDiagnosticsCoordinator";
import { CurrentBranchActionExecutor } from "../../currentBranch/CurrentBranchActionExecutor";
import { CurrentBranchCommandMapper } from "../../currentBranch/CurrentBranchCommandMapper";
import { CurrentBranchCommitHistory } from "../../currentBranch/CurrentBranchCommitHistory";
import { CurrentBranchCommitWatchService } from "../../currentBranch/CurrentBranchCommitWatchService";
import { VscodeCurrentBranchGitHubPullRequestAdapter } from "../../currentBranch/CurrentBranchGitHubPullRequestAdapter";
import { CurrentBranchJenkinsService } from "../../currentBranch/CurrentBranchJenkinsService";
import { CurrentBranchLinkResolver } from "../../currentBranch/CurrentBranchLinkResolver";
import { CurrentBranchLinkWorkflowService } from "../../currentBranch/CurrentBranchLinkWorkflowService";
import { CurrentBranchPullRequestJobNameMatcher } from "../../currentBranch/CurrentBranchPullRequestJobMatcher";
import { CurrentBranchRefreshCoordinator } from "../../currentBranch/CurrentBranchRefreshCoordinator";
import { CurrentBranchRepositoryResolver } from "../../currentBranch/CurrentBranchRepositoryResolver";
import { CurrentBranchStatusBar } from "../../currentBranch/CurrentBranchStatusBar";
import { CurrentBranchStatusResolver } from "../../currentBranch/CurrentBranchStatusResolver";
import { CurrentBranchTargetResolver } from "../../currentBranch/CurrentBranchTargetResolver";
import { CurrentBranchWorkflowService } from "../../currentBranch/CurrentBranchWorkflowService";
import { HistoryBaselineResolver, HistoryBaselineStore } from "../../history/HistoryBaseline";
import { HistoryService } from "../../history/HistoryService";
import { JenkinsfileCompletionProvider } from "../../jenkinsfile/editor/JenkinsfileCompletionProvider";
import { JenkinsfileSignatureHelpProvider } from "../../jenkinsfile/editor/JenkinsfileSignatureHelpProvider";
import { JenkinsfileStepHoverProvider } from "../../jenkinsfile/editor/JenkinsfileStepHoverProvider";
import { BuildComparePanelLauncher } from "../../panels/BuildComparePanelLauncher";
import { BuildDetailsPanelLauncher } from "../../panels/BuildDetailsPanelLauncher";
import type { BuildCompareOptions } from "../../panels/buildCompare/BuildCompareOptions";
import { BuildDetailsBackendAdapter } from "../../panels/buildDetails/BuildDetailsBackend";
import { JobHistoryPanelLauncher } from "../../panels/JobHistoryPanelLauncher";
import { BuildInspectionBackendAdapter } from "../../panels/shared/backend/BuildInspectionBackend";
import { JenkinsQueuePoller } from "../../queue/JenkinsQueuePoller";
import { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { JenkinsStatusRefreshService } from "../../services/JenkinsStatusRefreshService";
import { JenkinsfileHoverProvider } from "../../validation/editor/JenkinsfileHoverProvider";
import { JenkinsfileQuickFixProvider } from "../../validation/editor/JenkinsfileQuickFixProvider";
import { JenkinsfileValidationCodeLensProvider } from "../../validation/editor/JenkinsfileValidationCodeLensProvider";
import { JenkinsfileValidationHoverProvider } from "../../validation/editor/JenkinsfileValidationHoverProvider";
import { JenkinsStatusPoller } from "../../watch/JenkinsStatusPoller";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";
import { createExtensionRefreshHost } from "../ExtensionRefreshHost";
import { JenkinsWorkbenchDeepLinkBuildHandler } from "../JenkinsWorkbenchDeepLinkBuildHandler";
import { JenkinsWorkbenchDeepLinkJobHandler } from "../JenkinsWorkbenchDeepLinkJobHandler";
import { JenkinsWorkbenchUriHandler } from "../JenkinsWorkbenchUriHandler";
import { VscodeStatusNotifier } from "../VscodeStatusNotifier";

export interface RuntimeProviderOptions {
  context: vscode.ExtensionContext;
  extensionUri: vscode.Uri;
  buildCompareOptionsProvider: () => BuildCompareOptions;
  currentBranchPullRequestJobNamePatterns: readonly string[];
  statusRefreshIntervalSeconds: number;
  watchErrorThreshold: number;
  queuePollIntervalSeconds: number;
}

export function createRuntimeProviderCatalog(options: RuntimeProviderOptions) {
  return {
    historyService: (container) => {
      const service = new HistoryService(container.get("dataService"));
      options.context.subscriptions.push(
        service,
        container.get("environmentStore").onDidChange(() => service.invalidate())
      );
      return service;
    },
    historyBaselineStore: (_container) => new HistoryBaselineStore(options.context),
    historyBaselineResolver: (container) =>
      new HistoryBaselineResolver(
        container.get("dataService"),
        container.get("historyService"),
        container.get("historyBaselineStore")
      ),
    historyDependencies: (container) => ({
      environments: container.get("environmentStore"),
      history: container.get("historyService"),
      baseline: container.get("historyBaselineResolver"),
      data: container.get("dataService"),
      openBuild: (environment, buildUrl) =>
        container.get("buildDetailsPanelLauncher").show({ environment, buildUrl }),
      compare: (environment, baselineBuildUrl, targetBuildUrl) =>
        container
          .get("buildComparePanelLauncher")
          .show({ environment, baselineBuildUrl, targetBuildUrl }),
      openJob: (environment, jobUrl) =>
        container.get("jobHistoryPanelLauncher").show(environment, jobUrl)
    }),
    jobHistoryPanelLauncher: (container) =>
      new JobHistoryPanelLauncher(
        container.get("historyDependencies"),
        options.extensionUri,
        container.get("environmentStore")
      ),
    statusRefreshService: (_container) =>
      new JenkinsStatusRefreshService(options.statusRefreshIntervalSeconds),
    statusNotifier: (_container) => new VscodeStatusNotifier(),
    currentBranchRepositoryResolver: (_container) => new CurrentBranchRepositoryResolver(),
    commitHistory: (container) => new CurrentBranchCommitHistory(container.get("dataService")),
    commitWatchService: (container) =>
      new CurrentBranchCommitWatchService(
        container.get("commitWatchStore"),
        container.get("commitHistory"),
        container.get("dataService"),
        container.get("environmentStore"),
        container.get("statusRefreshService"),
        container.lazy("buildDetailsPanelLauncher")
      ),
    currentBranchLinkResolver: (container) =>
      new CurrentBranchLinkResolver(
        container.get("environmentStore"),
        container.get("repositoryLinkStore")
      ),
    currentBranchGitHubPullRequestAdapter: (_container) =>
      new VscodeCurrentBranchGitHubPullRequestAdapter(),
    currentBranchPullRequestJobMatcher: (_container) =>
      new CurrentBranchPullRequestJobNameMatcher(options.currentBranchPullRequestJobNamePatterns),
    currentBranchRefreshCoordinator: (_container) => new CurrentBranchRefreshCoordinator(),
    currentBranchTargetResolver: (container) =>
      new CurrentBranchTargetResolver(
        container.get("dataService"),
        container.get("currentBranchGitHubPullRequestAdapter"),
        container.get("currentBranchPullRequestJobMatcher")
      ),
    currentBranchStatusResolver: (container) =>
      new CurrentBranchStatusResolver(
        container.get("dataService"),
        container.get("currentBranchTargetResolver"),
        container.get("commitHistory")
      ),
    currentBranchLinkWorkflowService: (container) =>
      new CurrentBranchLinkWorkflowService(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("repositoryLinkStore")
      ),
    currentBranchCommandMapper: (_container) => new CurrentBranchCommandMapper(),
    coverageDecorationService: (container) => {
      // Built with the first Build Details panel; it owns editor decorations until deactivation.
      const service = new CoverageDecorationService(container.get("repositoryLinkStore"));
      options.context.subscriptions.push(service);
      return service;
    },
    buildDiagnosticsCoordinator: (container) =>
      new BuildDiagnosticsCoordinator(
        container.get("dataService"),
        container.get("currentBranchService"),
        container.get("currentBranchRepositoryResolver"),
        container.get("diagnosticBindingStore"),
        container.get("repositoryLinkStore"),
        container.get("statusRefreshService")
      ),
    buildDetailsPanelLauncher: (container) =>
      new BuildDetailsPanelLauncher({
        historyDependencies: container.get("historyDependencies"),
        backend: new BuildDetailsBackendAdapter(container.get("dataService")),
        artifactActionHandler: container.get("artifactActionHandler"),
        consoleExporter: container.get("consoleExporter"),
        coverageDecorationService: container.get("coverageDecorationService"),
        testSourceResolver: container.get("testSourceResolver"),
        testSourceNavigationUiService: container.get("testSourceNavigationUiService"),
        refreshHost: container.get("refreshHost"),
        pendingInputProvider: container.get("pendingInputCoordinator"),
        environmentStore: container.get("environmentStore"),
        buildDiagnosticsCoordinator: container.get("buildDiagnosticsCoordinator"),
        extensionUri: options.extensionUri
      }),
    buildComparePanelLauncher: (container) =>
      new BuildComparePanelLauncher({
        backend: new BuildInspectionBackendAdapter(container.get("dataService")),
        buildDetailsPanelLauncher: container.lazy("buildDetailsPanelLauncher"),
        getCompareOptions: options.buildCompareOptionsProvider,
        environmentStore: container.get("environmentStore"),
        extensionUri: options.extensionUri
      }),
    currentBranchActionExecutor: (container) =>
      new CurrentBranchActionExecutor(
        container.get("dataService"),
        container.get("presetStore"),
        container.get("queuedBuildWaiter"),
        container.lazy("buildDetailsPanelLauncher"),
        container.get("refreshHost")
      ),
    currentBranchService: (container) =>
      new CurrentBranchJenkinsService(
        container.get("currentBranchRepositoryResolver"),
        container.get("environmentStore"),
        container.get("currentBranchLinkResolver"),
        container.get("currentBranchStatusResolver"),
        container.get("currentBranchRefreshCoordinator"),
        container.get("statusRefreshService")
      ),
    currentBranchWorkflowService: (container) =>
      new CurrentBranchWorkflowService(
        container.get("currentBranchService"),
        container.get("currentBranchLinkWorkflowService"),
        container.get("currentBranchCommandMapper"),
        container.get("currentBranchActionExecutor"),
        container.get("commitWatchService")
      ),
    currentBranchStatusBar: (container) =>
      new CurrentBranchStatusBar(container.get("currentBranchService")),
    poller: (container) =>
      new JenkinsStatusPoller(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("statusRefreshService"),
        container.get("pendingInputCoordinator"),
        container.get("watchStore"),
        container.get("statusNotifier"),
        {
          fullEnvironmentRefresh: () => {
            container.get("refreshHost").fullEnvironmentRefresh({ trigger: "system" });
          }
        },
        options.watchErrorThreshold
      ),
    queuePoller: (container) =>
      new JenkinsQueuePoller(
        {
          refreshQueueOnly: (environment) => {
            container.get("refreshHost").refreshQueueOnly(environment);
          }
        },
        options.queuePollIntervalSeconds
      ),
    refreshHost: (container) =>
      createExtensionRefreshHost(
        container.get("environmentStore"),
        container.get("treeDataProvider"),
        container.get("queuePoller")
      ),
    buildDeepLinkHandler: (container) =>
      new JenkinsWorkbenchDeepLinkBuildHandler(container.lazy("buildDetailsPanelLauncher")),
    jobDeepLinkHandler: (container) =>
      new JenkinsWorkbenchDeepLinkJobHandler(container.get("treeNavigator")),
    uriHandler: (container) =>
      new JenkinsWorkbenchUriHandler(
        container.get("environmentStore"),
        container.get("buildDeepLinkHandler"),
        container.get("jobDeepLinkHandler")
      ),
    jenkinsfileQuickFixProvider: (container) =>
      new JenkinsfileQuickFixProvider(container.get("jenkinsfileMatcher")),
    jenkinsfileHoverProvider: (container) =>
      new JenkinsfileHoverProvider(
        new JenkinsfileValidationHoverProvider(
          container.get("jenkinsfileMatcher"),
          container.get("jenkinsfileValidationCoordinator")
        ),
        new JenkinsfileStepHoverProvider(
          container.get("jenkinsfileIntelligenceConfigState"),
          container.get("jenkinsfileMatcher"),
          container.get("jenkinsfileStepCatalogService")
        )
      ),
    jenkinsfileCodeLensProvider: (container) =>
      new JenkinsfileValidationCodeLensProvider(
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileValidationCoordinator")
      ),
    jenkinsfileCompletionProvider: (container) =>
      new JenkinsfileCompletionProvider(
        container.get("jenkinsfileIntelligenceConfigState"),
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileStepCatalogService")
      ),
    jenkinsfileSignatureHelpProvider: (container) =>
      new JenkinsfileSignatureHelpProvider(
        container.get("jenkinsfileIntelligenceConfigState"),
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileStepCatalogService")
      )
  } satisfies PartialExtensionProviderCatalog;
}
