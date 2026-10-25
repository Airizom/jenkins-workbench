import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { BuildDetailsPanelLauncher } from "../panels/BuildDetailsPanelLauncher";
import { NodeCapacityPanel } from "../panels/NodeCapacityPanel";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type {
  BuildQueueFolderTreeItem,
  NodesFolderTreeItem,
  QueueItemTreeItem
} from "../tree/TreeItems";
import { pickJenkinsEnvironment, withActionErrorMessage } from "./CommandUtils";

type NodeCapacityCommandSource =
  | NodesFolderTreeItem
  | BuildQueueFolderTreeItem
  | QueueItemTreeItem
  | JenkinsEnvironmentRef;

export function registerNodeCapacityCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  environmentStore: JenkinsEnvironmentStore,
  refreshHost: EnvironmentScopedRefreshHost,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.showNodeCapacity",
      (item?: NodeCapacityCommandSource) =>
        showNodeCapacity(
          dataService,
          environmentStore,
          refreshHost,
          buildDetailsPanelLauncher,
          context.extensionUri,
          item
        )
    )
  );
}

async function showNodeCapacity(
  dataService: JenkinsDataService,
  environmentStore: JenkinsEnvironmentStore,
  refreshHost: EnvironmentScopedRefreshHost,
  buildDetailsPanelLauncher: BuildDetailsPanelLauncher,
  extensionUri: vscode.Uri,
  item?: NodeCapacityCommandSource
): Promise<void> {
  const environment = await resolveEnvironment(environmentStore, item);
  if (!environment) {
    return;
  }

  await withActionErrorMessage("Unable to open node capacity", async () => {
    await NodeCapacityPanel.show({
      dataService,
      environment,
      extensionUri,
      refreshHost,
      buildDetailsPanelLauncher
    });
  });
}

async function resolveEnvironment(
  environmentStore: JenkinsEnvironmentStore,
  item?: NodeCapacityCommandSource
): Promise<JenkinsEnvironmentRef | undefined> {
  if (item && "environment" in item && isEnvironmentRef(item.environment)) {
    return item.environment;
  }
  if (isEnvironmentRef(item)) {
    return item;
  }

  return pickJenkinsEnvironment(environmentStore, {
    emptyMessage: "Add a Jenkins environment before viewing node capacity.",
    placeHolder: "Select a Jenkins environment for node capacity"
  });
}

function isEnvironmentRef(value: unknown): value is JenkinsEnvironmentRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as JenkinsEnvironmentRef;
  return (
    typeof candidate.environmentId === "string" &&
    typeof candidate.scope === "string" &&
    typeof candidate.url === "string"
  );
}
