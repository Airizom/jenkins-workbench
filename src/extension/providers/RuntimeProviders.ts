import type * as vscode from "vscode";
import { CurrentBranchActionExecutor } from "../../currentBranch/CurrentBranchActionExecutor";
import { CurrentBranchCommandMapper } from "../../currentBranch/CurrentBranchCommandMapper";
import { VscodeCurrentBranchGitHubPullRequestAdapter } from "../../currentBranch/CurrentBranchGitHubPullRequestAdapter";
import { CurrentBranchJenkinsService } from "../../currentBranch/CurrentBranchJenkinsService";
import { CurrentBranchLinkResolver } from "../../currentBranch/CurrentBranchLinkResolver";
import { CurrentBranchLinkWorkflowService } from "../../currentBranch/CurrentBranchLinkWorkflowService";
import { CurrentBranchPullRequestJobNameMatcher } from "../../currentBranch/CurrentBranchPullRequestJobMatcher";
import { CurrentBranchPullRequestService } from "../../currentBranch/CurrentBranchPullRequestService";
import { CurrentBranchRefreshCoordinator } from "../../currentBranch/CurrentBranchRefreshCoordinator";
import { CurrentBranchRepositoryResolver } from "../../currentBranch/CurrentBranchRepositoryResolver";
import { CurrentBranchStatusBar } from "../../currentBranch/CurrentBranchStatusBar";
import { CurrentBranchStatusResolver } from "../../currentBranch/CurrentBranchStatusResolver";
import { CurrentBranchTargetResolver } from "../../currentBranch/CurrentBranchTargetResolver";
import { CurrentBranchWorkflowService } from "../../currentBranch/CurrentBranchWorkflowService";
import { JenkinsfileCompletionProvider } from "../../jenkinsfile/editor/JenkinsfileCompletionProvider";
import { JenkinsfileSignatureHelpProvider } from "../../jenkinsfile/editor/JenkinsfileSignatureHelpProvider";
import { JenkinsfileStepHoverProvider } from "../../jenkinsfile/editor/JenkinsfileStepHoverProvider";
import { BuildComparePanelLauncher } from "../../panels/BuildComparePanelLauncher";
import { BuildDetailsPanelLauncher } from "../../panels/BuildDetailsPanelLauncher";
import { BuildCompareBackendAdapter } from "../../panels/buildCompare/BuildCompareBackend";
import type { BuildCompareOptions } from "../../panels/buildCompare/BuildCompareOptions";
import { BuildDetailsBackendAdapter } from "../../panels/buildDetails/BuildDetailsBackend";
import { JenkinsQueuePoller } from "../../queue/JenkinsQueuePoller";
import { CoverageDecorationService } from "../../services/CoverageDecorationService";
import { JenkinsStatusRefreshService } from "../../services/JenkinsStatusRefreshService";
import { JenkinsfileHoverProvider } from "../../validation/editor/JenkinsfileHoverProvider";
import { JenkinsfileQuickFixProvider } from "../../validation/editor/JenkinsfileQuickFixProvider";
import { JenkinsfileValidationCodeLensProvider } from "../../validation/editor/JenkinsfileValidationCodeLensProvider";
import { JenkinsfileValidationHoverProvider } from "../../validation/editor/JenkinsfileValidationHoverProvider";
import { JenkinsStatusPoller } from "../../watch/JenkinsStatusPoller";
import { createExtensionRefreshHost } from "../ExtensionRefreshHost";
import { JenkinsWorkbenchDeepLinkBuildHandler } from "../JenkinsWorkbenchDeepLinkBuildHandler";
import { JenkinsWorkbenchDeepLinkJobHandler } from "../JenkinsWorkbenchDeepLinkJobHandler";
import { JenkinsWorkbenchUriHandler } from "../JenkinsWorkbenchUriHandler";
import { VscodeStatusNotifier } from "../VscodeStatusNotifier";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";

export interface RuntimeProviderOptions {
  extensionUri: vscode.Uri;
  buildCompareOptionsProvider: () => BuildCompareOptions;
  currentBranchPullRequestJobNamePatterns: readonly string[];
  statusRefreshIntervalSeconds: number;
  watchErrorThreshold: number;
  queuePollIntervalSeconds: number;
}

export function createRuntimeProviderCatalog(options: RuntimeProviderOptions) {
  return {
    statusRefreshService: (_container) =>
      new JenkinsStatusRefreshService(options.statusRefreshIntervalSeconds),
    statusNotifier: (_container) => new VscodeStatusNotifier(),
    currentBranchRepositoryResolver: (_container) => new CurrentBranchRepositoryResolver(),
    currentBranchLinkResolver: (container) =>
      new CurrentBranchLinkResolver(
        container.get("environmentStore"),
        container.get("repositoryLinkStore")
      ),
    currentBranchGitHubPullRequestAdapter: (_container) =>
      new VscodeCurrentBranchGitHubPullRequestAdapter(),
    currentBranchPullRequestService: (container) =>
      new CurrentBranchPullRequestService(container.get("currentBranchGitHubPullRequestAdapter")),
    currentBranchPullRequestJobMatcher: (_container) =>
      new CurrentBranchPullRequestJobNameMatcher(options.currentBranchPullRequestJobNamePatterns),
    currentBranchRefreshCoordinator: (_container) => new CurrentBranchRefreshCoordinator(),
    currentBranchTargetResolver: (container) =>
      new CurrentBranchTargetResolver(
        container.get("dataService"),
        container.get("currentBranchPullRequestService"),
        container.get("currentBranchPullRequestJobMatcher")
      ),
    currentBranchStatusResolver: (container) =>
      new CurrentBranchStatusResolver(
        container.get("dataService"),
        container.get("currentBranchTargetResolver")
      ),
    currentBranchLinkWorkflowService: (container) =>
      new CurrentBranchLinkWorkflowService(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("repositoryLinkStore")
      ),
    currentBranchCommandMapper: (_container) => new CurrentBranchCommandMapper(),
    coverageDecorationService: (container) =>
      new CoverageDecorationService(container.get("repositoryLinkStore")),
    buildDetailsPanelLauncher: (container) =>
      new BuildDetailsPanelLauncher({
        backend: new BuildDetailsBackendAdapter(
          container.get("dataService"),
          container.get("coverageService")
        ),
        artifactActionHandler: container.get("artifactActionHandler"),
        consoleExporter: container.get("consoleExporter"),
        coverageDecorationService: container.get("coverageDecorationService"),
        testSourceNavigationService: container.get("testSourceNavigationService"),
        testSourceNavigationUiService: container.get("testSourceNavigationUiService"),
        refreshHost: container.get("refreshHost"),
        pendingInputProvider: container.get("pendingInputCoordinator"),
        environmentStore: container.get("environmentStore"),
        extensionUri: options.extensionUri
      }),
    buildComparePanelLauncher: (container) =>
      new BuildComparePanelLauncher({
        backend: new BuildCompareBackendAdapter(container.get("dataService")),
        buildDetailsPanelLauncher: container.get("buildDetailsPanelLauncher"),
        getCompareOptions: options.buildCompareOptionsProvider,
        environmentStore: container.get("environmentStore"),
        extensionUri: options.extensionUri
      }),
    currentBranchActionExecutor: (container) =>
      new CurrentBranchActionExecutor(
        container.get("dataService"),
        container.get("presetStore"),
        container.get("queuedBuildWaiter"),
        container.get("buildDetailsPanelLauncher"),
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
        container.get("currentBranchActionExecutor")
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
      new JenkinsWorkbenchDeepLinkBuildHandler(container.get("buildDetailsPanelLauncher")),
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
