import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { NodeCapacityPanel } from "../panels/NodeCapacityPanel";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type {
  BuildQueueFolderTreeItem,
  NodesFolderTreeItem,
  QueueItemTreeItem
} from "../tree/TreeItems";
import { withActionErrorMessage } from "./CommandUtils";

type NodeCapacityCommandSource =
  | NodesFolderTreeItem
  | BuildQueueFolderTreeItem
  | QueueItemTreeItem
  | JenkinsEnvironmentRef;

export function registerNodeCapacityCommands(
  context: vscode.ExtensionContext,
  dataService: JenkinsDataService,
  environmentStore: JenkinsEnvironmentStore,
  refreshHost: EnvironmentScopedRefreshHost
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.showNodeCapacity",
      (item?: NodeCapacityCommandSource) =>
        showNodeCapacity(dataService, environmentStore, refreshHost, context.extensionUri, item)
    )
  );
}

async function showNodeCapacity(
  dataService: JenkinsDataService,
  environmentStore: JenkinsEnvironmentStore,
  refreshHost: EnvironmentScopedRefreshHost,
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
      refreshHost
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

  const environments = await environmentStore.listEnvironmentsWithScope();
  if (environments.length === 0) {
    void vscode.window.showInformationMessage(
      "Add a Jenkins environment before viewing node capacity."
    );
    return undefined;
  }
  if (environments.length === 1) {
    const [environment] = environments;
    return {
      environmentId: environment.id,
      scope: environment.scope,
      url: environment.url,
      username: environment.username
    };
  }

  const pick = await vscode.window.showQuickPick(
    environments.map((environment) => ({
      label: formatEnvironmentLabel(environment.url),
      description: environment.scope,
      environment
    })),
    {
      placeHolder: "Select a Jenkins environment for node capacity",
      matchOnDescription: true
    }
  );

  if (!pick) {
    return undefined;
  }
  return {
    environmentId: pick.environment.id,
    scope: pick.environment.scope,
    url: pick.environment.url,
    username: pick.environment.username
  };
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

function formatEnvironmentLabel(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname && parsed.pathname !== "/"
      ? `${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`
      : parsed.host;
  } catch {
    return rawUrl;
  }
}
