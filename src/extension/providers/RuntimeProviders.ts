import type * as vscode from "vscode";
import { JenkinsQueuePoller } from "../../queue/JenkinsQueuePoller";
import { JenkinsfileHoverProvider } from "../../validation/editor/JenkinsfileHoverProvider";
import { JenkinsfileQuickFixProvider } from "../../validation/editor/JenkinsfileQuickFixProvider";
import { JenkinsfileValidationCodeLensProvider } from "../../validation/editor/JenkinsfileValidationCodeLensProvider";
import { JenkinsStatusPoller } from "../../watch/JenkinsStatusPoller";
import { createExtensionRefreshHost } from "../ExtensionRefreshHost";
import { JenkinsWorkbenchDeepLinkBuildHandler } from "../JenkinsWorkbenchDeepLinkBuildHandler";
import { JenkinsWorkbenchDeepLinkJobHandler } from "../JenkinsWorkbenchDeepLinkJobHandler";
import { JenkinsWorkbenchUriHandler } from "../JenkinsWorkbenchUriHandler";
import { VscodeStatusNotifier } from "../VscodeStatusNotifier";
import type { PartialExtensionProviderCatalog } from "../container/ExtensionContainer";

export interface RuntimeProviderOptions {
  extensionUri: vscode.Uri;
  pollIntervalSeconds: number;
  watchErrorThreshold: number;
  queuePollIntervalSeconds: number;
}

export function createRuntimeProviderCatalog(options: RuntimeProviderOptions) {
  return {
    statusNotifier: (_container) => new VscodeStatusNotifier(),
    poller: (container) =>
      new JenkinsStatusPoller(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("pendingInputCoordinator"),
        container.get("watchStore"),
        container.get("statusNotifier"),
        {
          fullEnvironmentRefresh: () => {
            container.get("refreshHost").fullEnvironmentRefresh({ trigger: "system" });
          }
        },
        options.pollIntervalSeconds,
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
      new JenkinsWorkbenchDeepLinkBuildHandler(
        container.get("dataService"),
        container.get("artifactActionHandler"),
        container.get("consoleExporter"),
        container.get("refreshHost"),
        container.get("pendingInputCoordinator"),
        options.extensionUri
      ),
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
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileValidationCoordinator")
      ),
    jenkinsfileCodeLensProvider: (container) =>
      new JenkinsfileValidationCodeLensProvider(
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileValidationCoordinator")
      )
  } satisfies PartialExtensionProviderCatalog;
}
