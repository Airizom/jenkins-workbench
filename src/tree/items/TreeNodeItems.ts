import * as vscode from "vscode";
import type { JenkinsNodeInfo } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  formatNodeBusyExecutorRatio,
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
    this.tooltip = buildNodeTooltip(node);
    this.command = {
      command: "jenkinsWorkbench.showNodeDetails",
      title: "View Node Details",
      arguments: [this]
    };
  }
}

function buildNodeTooltip(node: JenkinsNodeInfo): string {
  const statusLabel = resolveNodeStatusDescriptor(node).label;
  const lines = [node.displayName, statusLabel];
  if (node.offline) {
    const reason = formatNodeOfflineReason(node);
    if (reason) {
      lines.push(reason);
    }
  } else {
    const busy = formatNodeBusyExecutorRatio(node, { prefix: "Executors busy: " });
    if (busy) {
      lines.push(busy);
    }
  }
  lines.push("Click to view node details.");
  return lines.join("\n");
}
