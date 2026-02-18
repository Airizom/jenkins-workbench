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
import type { ExtensionContainer } from "../container/ExtensionContainer";

export interface RuntimeProviderOptions {
  extensionUri: vscode.Uri;
  pollIntervalSeconds: number;
  watchErrorThreshold: number;
  queuePollIntervalSeconds: number;
}

export function registerRuntimeProviders(
  container: ExtensionContainer,
  options: RuntimeProviderOptions
): void {
  container.register("statusNotifier", () => new VscodeStatusNotifier());

  container.register(
    "poller",
    () =>
      new JenkinsStatusPoller(
        container.get("environmentStore"),
        container.get("dataService"),
        container.get("pendingInputCoordinator"),
        container.get("watchStore"),
        container.get("statusNotifier"),
        {
          refreshTree: () => container.get("treeDataProvider").onEnvironmentChanged()
        },
        options.pollIntervalSeconds,
        options.watchErrorThreshold
      )
  );

  container.register(
    "queuePoller",
    () =>
      new JenkinsQueuePoller(
        {
          refreshQueueView: (environment) => {
            container.get("treeDataProvider").refreshQueueFolder(environment);
          }
        },
        options.queuePollIntervalSeconds
      )
  );

  container.register("refreshHost", () =>
    createExtensionRefreshHost(
      container.get("environmentStore"),
      container.get("treeDataProvider"),
      container.get("queuePoller")
    )
  );

  container.register(
    "buildDeepLinkHandler",
    () =>
      new JenkinsWorkbenchDeepLinkBuildHandler(
        container.get("dataService"),
        container.get("artifactActionHandler"),
        container.get("consoleExporter"),
        container.get("refreshHost"),
        container.get("pendingInputCoordinator"),
        options.extensionUri
      )
  );

  container.register(
    "jobDeepLinkHandler",
    () => new JenkinsWorkbenchDeepLinkJobHandler(container.get("treeNavigator"))
  );

  container.register(
    "uriHandler",
    () =>
      new JenkinsWorkbenchUriHandler(
        container.get("environmentStore"),
        container.get("buildDeepLinkHandler"),
        container.get("jobDeepLinkHandler")
      )
  );

  container.register(
    "jenkinsfileQuickFixProvider",
    () => new JenkinsfileQuickFixProvider(container.get("jenkinsfileMatcher"))
  );

  container.register(
    "jenkinsfileHoverProvider",
    () =>
      new JenkinsfileHoverProvider(
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileValidationCoordinator")
      )
  );

  container.register(
    "jenkinsfileCodeLensProvider",
    () =>
      new JenkinsfileValidationCodeLensProvider(
        container.get("jenkinsfileMatcher"),
        container.get("jenkinsfileValidationCoordinator")
      )
  );
}
