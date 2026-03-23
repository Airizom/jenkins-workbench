import * as vscode from "vscode";
import type { JenkinsNodeInfo } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { buildNodeActionCapabilities } from "../../jenkins/nodeActionCapabilities";
import { formatNodeDescription } from "../formatters";

export class NodeTreeItem extends vscode.TreeItem {
  public readonly nodeUrl?: string;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    node: JenkinsNodeInfo
  ) {
    super(node.displayName, vscode.TreeItemCollapsibleState.None);
    this.nodeUrl = node.nodeUrl;
    const contextValues = ["node"];
    const capabilities = buildNodeActionCapabilities(node);
    if (node.nodeUrl) {
      contextValues.push("nodeOpenable");
    }
    if (capabilities.canTakeOffline) {
      contextValues.push("nodeOnline");
    }
    if (capabilities.isTemporarilyOffline) {
      contextValues.push("nodeTemporarilyOffline");
    }
    if (capabilities.canLaunchAgent) {
      contextValues.push("nodeLaunchable");
    }
    this.contextValue = contextValues.join(" ");
    this.description = formatNodeDescription(node);
    this.iconPath = node.offline
      ? new vscode.ThemeIcon("server", new vscode.ThemeColor("charts.gray"))
      : new vscode.ThemeIcon("server");
    const tooltip = buildNodeTooltip(node);
    if (tooltip) {
      this.tooltip = tooltip;
    }
    this.command = {
      command: "jenkinsWorkbench.showNodeDetails",
      title: "View Node Details",
      arguments: [this]
    };
  }
}

function buildNodeTooltip(node: JenkinsNodeInfo): string | undefined {
  if (!node.offline) {
    return undefined;
  }
  const reason = formatNodeOfflineReason(node);
  const statusLabel = node.temporarilyOffline ? "Temporarily offline" : "Offline";
  return reason ? `${statusLabel}\n${reason}` : statusLabel;
}

function formatNodeOfflineReason(node: JenkinsNodeInfo): string | undefined {
  const reason =
    node.offlineCauseReason?.trim() ||
    node.offlineCause?.description?.trim() ||
    node.offlineCause?.shortDescription?.trim();
  return reason && reason.length > 0 ? reason : undefined;
}
