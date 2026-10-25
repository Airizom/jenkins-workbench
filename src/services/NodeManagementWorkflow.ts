import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  type NodeCreateInput,
  UnsupportedNodeConfigurationError,
  validateNodeName
} from "../jenkins/NodeManagement";
import { buildActionUrl } from "../jenkins/urls";
import { openJenkinsWorkbenchUrl } from "../ui/OpenExternalUrl";
import type { NodeActionRefreshHost, NodeActionTarget } from "./NodeActionService";

/** Interactive node mutations. Configuration XML stays behind the data-service façade. */
export class NodeManagementWorkflow {
  constructor(private readonly dataService: JenkinsDataService) {}

  async editNodeLabels(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    try {
      for (;;) {
        const configuration = await this.dataService.getNodeConfiguration(
          target.environment,
          target.nodeUrl
        );
        const input = await vscode.window.showInputBox({
          title: `Edit labels for ${target.label}`,
          prompt:
            "Configured labels only. Separate labels with spaces; quote labels containing spaces. Clear the value to remove all configured labels. Automatic labels remain unchanged.",
          value: configuration.labels,
          ignoreFocusOut: true,
          validateInput: validateLabels
        });
        if (input === undefined || input === configuration.labels) {
          return false;
        }
        const result = await this.dataService.updateNodeLabels(
          target.environment,
          target.nodeUrl,
          input,
          configuration.labels
        );
        if (result.status === "conflict") {
          const selected = await vscode.window.showWarningMessage(
            `The configured labels for ${target.label} changed in Jenkins. Reload them before editing again.`,
            { modal: true },
            "Reload Labels"
          );
          if (selected === "Reload Labels") {
            continue;
          }
          return false;
        }
        if (result.status === "no_change") {
          return false;
        }
        this.refresh(target.environment, refreshHost);
        void vscode.window.showInformationMessage(`Updated labels for ${target.label}.`);
        return true;
      }
    } catch (error) {
      await this.showFailure(`Failed to edit labels for ${target.label}`, error, target);
      return false;
    }
  }

  async disconnectNodeAgent(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    try {
      const details = await this.dataService.getNodeDetails(target.environment, target.nodeUrl, {
        mode: "refresh"
      });
      // Jenkins' offline flag includes connected agents marked temporarily offline.
      if (details.offline === true && details.temporarilyOffline !== true) {
        void vscode.window.showInformationMessage(`${target.label} is already disconnected.`);
        return false;
      }
      const reason = await vscode.window.showInputBox({
        title: `Disconnect ${target.label}`,
        prompt:
          "Disconnecting the agent can interrupt running builds and cause them to fail. Press Enter to confirm; the reason is optional.",
        placeHolder: "Disconnect reason (optional)",
        ignoreFocusOut: true
      });
      if (reason === undefined) {
        return false;
      }
      const result = await this.dataService.disconnectNodeAgent(
        target.environment,
        target.nodeUrl,
        reason.trim() || undefined
      );
      if (result.status === "no_change") {
        void vscode.window.showInformationMessage(`${target.label} is already disconnected.`);
        return false;
      }
      this.refresh(target.environment, refreshHost);
      void vscode.window.showInformationMessage(`Disconnect requested for ${target.label}.`);
      return true;
    } catch (error) {
      await this.showFailure(`Failed to disconnect ${target.label}`, error, target);
      return false;
    }
  }

  async deleteNode(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    try {
      const configuration = await this.dataService.getNodeConfiguration(
        target.environment,
        target.nodeUrl
      );
      await this.dataService.checkNodeDeletion(target.environment, target.nodeUrl);
      const name = configuration.name;
      const typedName = await vscode.window.showInputBox({
        title: `Delete ${target.label}`,
        prompt: `Type "${name}" to confirm deletion of this node configuration. This cannot be undone.`,
        placeHolder: name,
        ignoreFocusOut: true,
        validateInput: (value) =>
          value === name ? undefined : `Type the exact node name "${name}".`
      });
      if (typedName !== name) {
        return false;
      }
      if (
        !(await confirm(
          `Delete node "${name}" permanently? Jenkins will remove its node configuration.`,
          "Delete Permanently"
        ))
      ) {
        return false;
      }
      // The data layer repeats configuration and activity checks immediately before POST.
      await this.dataService.deleteNode(target.environment, target.nodeUrl);
      this.refresh(target.environment, refreshHost);
      void vscode.window.showInformationMessage(`Deleted node "${name}".`);
      return true;
    } catch (error) {
      await this.showFailure(`Failed to delete ${target.label}`, error, target);
      return false;
    }
  }

  async copyNode(target: NodeActionTarget, refreshHost?: NodeActionRefreshHost): Promise<boolean> {
    try {
      const source = await this.dataService.getNodeConfiguration(
        target.environment,
        target.nodeUrl
      );
      const names = await this.getNodeNames(target.environment);
      const name = await vscode.window.showInputBox({
        title: `Copy ${target.label}`,
        prompt:
          "Enter a name for the copied node. Review its machine-specific settings in Jenkins before saving or launching.",
        value: suggestCopyName(source.name, names),
        ignoreFocusOut: true,
        validateInput: (value) => validateUniqueName(value, names)
      });
      if (name === undefined || validateUniqueName(name, names)) {
        return false;
      }
      if (
        !(await confirm(
          `Copy "${source.name}" to "${name}" and open its Jenkins configuration for review?`,
          "Copy Node"
        ))
      ) {
        return false;
      }
      const result = await this.dataService.copyNode(target.environment, target.nodeUrl, name);
      this.refresh(target.environment, refreshHost);
      if (result.status === "exists_after_error") {
        void vscode.window.showWarningMessage(
          `Jenkins did not confirm copying "${name}", but a node with that name now exists. Inspect its configuration before retrying.`
        );
      } else {
        void vscode.window.showInformationMessage(
          `Copied "${source.name}" to "${name}". Review the configuration in Jenkins before saving or launching.`
        );
      }
      await this.openConfiguration(result.nodeUrl);
      return true;
    } catch (error) {
      await this.showFailure(`Failed to copy ${target.label}`, error, target);
      return false;
    }
  }

  async createNode(
    environment: JenkinsEnvironmentRef,
    refreshHost?: NodeActionRefreshHost
  ): Promise<NodeActionTarget | undefined> {
    try {
      const names = await this.getNodeNames(environment);
      const input = await promptNodeCreation(names);
      if (!input) {
        return undefined;
      }
      const result = await this.dataService.createNode(environment, input);
      this.refresh(environment, refreshHost);
      if (result.status === "exists_after_error") {
        void vscode.window.showWarningMessage(
          `Jenkins did not confirm creating "${input.name}", but a node with that name now exists. Inspect its details before retrying.`
        );
      } else {
        void vscode.window.showInformationMessage(
          `Created inbound agent "${input.name}". Open its agent instructions in Jenkins to connect it.`
        );
      }
      return { environment, nodeUrl: result.nodeUrl, label: input.name };
    } catch (error) {
      void vscode.window.showErrorMessage(`Failed to create node: ${formatActionError(error)}`);
      return undefined;
    }
  }

  private async getNodeNames(environment: JenkinsEnvironmentRef): Promise<Set<string>> {
    const nodes = await this.dataService.getNodes(environment, { mode: "refresh" });
    return new Set(nodes.map((node) => node.name ?? node.displayName));
  }

  private refresh(environment: JenkinsEnvironmentRef, refreshHost?: NodeActionRefreshHost): void {
    refreshHost?.fullEnvironmentRefresh({ environmentId: environment.environmentId });
  }

  private async showFailure(
    message: string,
    error: unknown,
    target: NodeActionTarget
  ): Promise<void> {
    if (error instanceof UnsupportedNodeConfigurationError) {
      const selected = await vscode.window.showInformationMessage(
        `${target.label} is not a supported permanent agent. Manage this node in Jenkins.`,
        "Open in Jenkins"
      );
      if (selected === "Open in Jenkins") {
        await this.openConfiguration(target.nodeUrl);
      }
      return;
    }
    void vscode.window.showErrorMessage(`${message}: ${formatActionError(error)}`);
  }

  private async openConfiguration(nodeUrl: string): Promise<void> {
    try {
      await openJenkinsWorkbenchUrl(buildActionUrl(nodeUrl, "configure"), "Node Management");
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to open node configuration: ${formatActionError(error)}`
      );
    }
  }
}

async function promptNodeCreation(names: Set<string>): Promise<NodeCreateInput | undefined> {
  const title = "Create permanent inbound agent";
  const name = await vscode.window.showInputBox({
    title,
    prompt: "1 of 6: Unique node name",
    ignoreFocusOut: true,
    validateInput: (value) => validateUniqueName(value, names)
  });
  if (name === undefined || validateUniqueName(name, names)) {
    return undefined;
  }
  const remoteFS = await vscode.window.showInputBox({
    title,
    prompt: "2 of 6: Remote filesystem root on the agent machine",
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "Enter the remote filesystem root.")
  });
  if (remoteFS === undefined || !remoteFS.trim()) {
    return undefined;
  }
  const executorInput = await vscode.window.showInputBox({
    title,
    prompt: "3 of 6: Number of executors",
    value: "1",
    ignoreFocusOut: true,
    validateInput: validateExecutors
  });
  if (executorInput === undefined || validateExecutors(executorInput)) {
    return undefined;
  }
  const labels = await vscode.window.showInputBox({
    title,
    prompt:
      "4 of 6: Configured labels (optional). Separate with spaces; quote labels containing spaces.",
    value: "",
    ignoreFocusOut: true,
    validateInput: validateLabels
  });
  if (labels === undefined) {
    return undefined;
  }
  const mode = await vscode.window.showQuickPick(
    [
      {
        label: "Normal",
        description: "Use this node as much as possible",
        mode: "NORMAL" as const
      },
      {
        label: "Label-restricted",
        description: "Only build jobs whose label expressions match this node",
        mode: "EXCLUSIVE" as const
      }
    ],
    {
      title,
      placeHolder: "5 of 6: Choose how Jenkins schedules work on this node",
      ignoreFocusOut: true
    }
  );
  if (!mode) {
    return undefined;
  }
  const description = await vscode.window.showInputBox({
    title,
    prompt: "6 of 6: Description (optional)",
    value: "",
    ignoreFocusOut: true
  });
  if (description === undefined) {
    return undefined;
  }
  const input: NodeCreateInput = {
    name,
    remoteFS: remoteFS.trim(),
    numExecutors: Number(executorInput),
    labels,
    mode: mode.mode,
    description: description.trim() || undefined
  };
  const summary = [
    `Create permanent inbound agent "${input.name}"?`,
    `Remote root: ${input.remoteFS}`,
    `Executors: ${input.numExecutors}`,
    `Labels: ${input.labels || "(none)"}`,
    `Usage: ${mode.label}`,
    `Description: ${input.description || "(none)"}`
  ].join("\n");
  return (await confirm(summary, "Create Node")) ? input : undefined;
}

function confirm(message: string, action: string): PromiseLike<boolean> {
  return vscode.window
    .showWarningMessage(message, { modal: true }, action)
    .then((selected) => selected === action);
}

function validateUniqueName(value: string, names: Set<string>): string | undefined {
  return (
    validateNodeName(value) ??
    (names.has(value) ? "A node with this name already exists." : undefined)
  );
}

function suggestCopyName(name: string, names: Set<string>): string {
  let candidate = `${name}-copy`;
  for (let index = 2; names.has(candidate); index++) {
    candidate = `${name}-copy-${index}`;
  }
  return candidate;
}

function validateExecutors(value: string): string | undefined {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? undefined
    : "Enter a positive whole number of executors.";
}

function validateLabels(value: string): string | undefined {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      return "Labels cannot contain control characters.";
    }
  }
  return undefined;
}
