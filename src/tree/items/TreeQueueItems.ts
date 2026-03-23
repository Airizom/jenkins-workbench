import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import { formatQueueItemDescription, normalizeQueueReason } from "../formatters";

type QueueTreeItemData = {
  id: number;
  name: string;
  position: number;
  reason?: string;
  inQueueSince?: number;
  taskUrl?: string;
};

export class QueueItemTreeItem extends vscode.TreeItem {
  public readonly queueId: number;

  constructor(
    public readonly environment: JenkinsEnvironmentRef,
    item: QueueTreeItemData
  ) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.queueId = item.id;
    this.contextValue = "queueItem";
    this.description = formatQueueItemDescription(item.position, item.inQueueSince);
    this.tooltip = this.buildTooltip(item);
    this.iconPath = new vscode.ThemeIcon("clock");
  }

  private buildTooltip(item: QueueTreeItemData): string {
    const parts: string[] = [];
    const normalizedReason = normalizeQueueReason(item.reason);
    if (normalizedReason) {
      parts.push(normalizedReason);
    } else {
      parts.push("Waiting in queue");
    }
    if (item.taskUrl) {
      parts.push(item.taskUrl);
    }
    parts.push(`Queue ID: ${item.id}`);
    if (typeof item.inQueueSince === "number") {
      parts.push(`Queued since: ${new Date(item.inQueueSince).toLocaleString()}`);
    }
    return parts.join("\n");
  }
}
