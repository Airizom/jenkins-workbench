import * as vscode from "vscode";
import type { JenkinsNodeInfo } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  formatNodeOfflineReason,
  formatNodeTreeDescription,
  resolveNodeStatusDescriptor
} from "../../jenkins/NodeFormatters";
import { buildNodeActionCapabilities } from "../../jenkins/nodeActionCapabilities";

const SERVER_ICON = new vscode.ThemeIcon("server");
const SERVER_OFFLINE_ICON = new vscode.ThemeIcon("server", new vscode.ThemeColor("charts.gray"));

export class NodeTreeItem extends vscode.TreeItem {
  public readonly nodeUrl?: string;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    node: JenkinsNodeInfo
  ) {
    super(node.displayName, vscode.TreeItemCollapsibleState.None);
    this.nodeUrl = node.nodeUrl;
    let contextValue = "node";
    const capabilities = buildNodeActionCapabilities(node);
    if (node.nodeUrl) {
      contextValue += " nodeOpenable";
    }
    if (capabilities.canTakeOffline) {
      contextValue += " nodeOnline";
    }
    if (capabilities.isTemporarilyOffline) {
      contextValue += " nodeTemporarilyOffline";
    }
    if (capabilities.canLaunchAgent) {
      contextValue += " nodeLaunchable";
    }
    this.contextValue = contextValue;
    this.description = formatNodeTreeDescription(node);
    this.iconPath = node.offline ? SERVER_OFFLINE_ICON : SERVER_ICON;
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
  const statusLabel = resolveNodeStatusDescriptor(node).label;
  return reason ? `${statusLabel}\n${reason}` : statusLabel;
}
