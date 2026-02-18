import type * as vscode from "vscode";
import { registerBuildCommands } from "../commands/BuildCommands";
import { registerEnvironmentCommands } from "../commands/EnvironmentCommands";
import { registerJenkinsfileCommands } from "../commands/JenkinsfileCommands";
import { registerJobCommands } from "../commands/JobCommands";
import { registerNodeCommands } from "../commands/NodeCommands";
import { registerPinCommands } from "../commands/PinCommands";
import { registerQueueCommands } from "../commands/QueueCommands";
import { registerRefreshCommands } from "../commands/RefreshCommands";
import { registerSearchCommands } from "../commands/SearchCommands";
import { registerWatchCommands } from "../commands/WatchCommands";
import type { ExtensionContainer } from "./container/ExtensionContainer";

export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const refreshHost = container.get("refreshHost");

  registerEnvironmentCommands(
    context,
    container.get("environmentStore"),
    container.get("presetStore"),
    container.get("watchStore"),
    container.get("pinStore"),
    container.get("clientProvider"),
    refreshHost
  );

  registerBuildCommands(
    context,
    container.get("dataService"),
    container.get("presetStore"),
    container.get("artifactActionHandler"),
    container.get("buildLogPreviewer"),
    container.get("consoleExporter"),
    container.get("queuedBuildWaiter"),
    container.get("pendingInputCoordinator"),
    refreshHost
  );

  registerJobCommands(
    context,
    container.get("dataService"),
    container.get("environmentStore"),
    container.get("jobConfigPreviewer"),
    refreshHost,
    container.get("jobConfigDraftManager"),
    container.get("jobConfigUpdateWorkflow"),
    container.get("presetStore"),
    container.get("pinStore"),
    container.get("watchStore")
  );

  registerNodeCommands(context, container.get("dataService"), refreshHost);

  registerQueueCommands(context, container.get("dataService"), refreshHost);

  registerWatchCommands(context, container.get("watchStore"), refreshHost);

  registerPinCommands(context, container.get("pinStore"), refreshHost);

  registerSearchCommands(
    context,
    container.get("environmentStore"),
    container.get("dataService"),
    container.get("viewStateStore"),
    container.get("treeNavigator")
  );

  registerRefreshCommands(
    context,
    container.get("treeDataProvider"),
    container.get("treeExpansionState"),
    refreshHost
  );

  registerJenkinsfileCommands(
    context,
    container.get("jenkinsfileValidationCoordinator"),
    container.get("jenkinsfileEnvironmentResolver"),
    container.get("environmentStore")
  );
}
