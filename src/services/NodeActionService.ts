import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsNodeDetails } from "../jenkins/types";
import { formatActionError } from "../formatters/ErrorFormatters";

export type NodeActionTarget = {
  environment: JenkinsEnvironmentRef;
  nodeUrl: string;
  label: string;
};

export interface NodeActionRefreshHost {
  refreshEnvironment(environmentId: string): void;
}

export class NodeActionService {
  constructor(private readonly dataService: JenkinsDataService) {}

  async takeNodeOffline(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    const reasonInput = await vscode.window.showInputBox({
      prompt: `Offline reason for ${target.label} (optional)`,
      placeHolder: "Why are you taking this node offline?",
      ignoreFocusOut: true
    });
    if (reasonInput === undefined) {
      return false;
    }
    const trimmedReason = reasonInput.trim();
    const reason = trimmedReason.length > 0 ? trimmedReason : undefined;

    try {
      const result = await this.dataService.setNodeTemporarilyOffline(
        target.environment,
        target.nodeUrl,
        true,
        reason
      );
      if (result.status === "toggled") {
        if (result.details.temporarilyOffline) {
          void vscode.window.showInformationMessage(`Took ${target.label} offline.`);
        } else {
          void vscode.window.showInformationMessage(
            `${target.label} did not enter a temporary offline state.`
          );
        }
        refreshHost?.refreshEnvironment(target.environment.environmentId);
        return true;
      }
      void vscode.window.showInformationMessage(`${target.label} is already offline.`);
      return false;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to take ${target.label} offline: ${formatActionError(error)}`
      );
      return false;
    }
  }

  async bringNodeOnline(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    try {
      const result = await this.dataService.setNodeTemporarilyOffline(
        target.environment,
        target.nodeUrl,
        false
      );
      if (result.status === "toggled") {
        if (result.details.temporarilyOffline) {
          void vscode.window.showInformationMessage(
            `${target.label} is still temporarily offline. Use Jenkins to update its status.`
          );
        } else if (result.details.offline) {
          const offlineReason = this.formatOfflineReason(result.details);
          const reasonLabel = offlineReason ? ` Reason: ${offlineReason}` : "";
          void vscode.window.showInformationMessage(
            `Cleared temporary offline for ${target.label}, but it is still offline.${reasonLabel}`
          );
        } else {
          void vscode.window.showInformationMessage(`Brought ${target.label} online.`);
        }
        refreshHost?.refreshEnvironment(target.environment.environmentId);
        return true;
      }
      if (result.status === "not_temporarily_offline") {
        const offlineReason = this.formatOfflineReason(result.details);
        const reasonLabel = offlineReason ? ` Reason: ${offlineReason}` : "";
        void vscode.window.showInformationMessage(
          `${target.label} is offline but not temporarily offline. Use Jenkins to bring it online.${reasonLabel}`
        );
        return false;
      }
      void vscode.window.showInformationMessage(`${target.label} is already online.`);
      return false;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to bring ${target.label} online: ${formatActionError(error)}`
      );
      return false;
    }
  }

  async launchNodeAgent(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    try {
      const result = await this.dataService.launchNodeAgent(target.environment, target.nodeUrl);
      if (result.status === "launched") {
        const offlineReason = this.formatOfflineReason(result.details);
        const reasonLabel = offlineReason ? ` Reason: ${offlineReason}` : "";
        if (result.details.offline) {
          void vscode.window.showInformationMessage(
            `Launch requested for ${target.label}, but it is still offline.${reasonLabel}`
          );
        } else {
          void vscode.window.showInformationMessage(`Launched ${target.label}.`);
        }
        refreshHost?.refreshEnvironment(target.environment.environmentId);
        return true;
      }
      if (result.status === "not_launchable") {
        if (result.details.manualLaunchAllowed) {
          void vscode.window.showInformationMessage(
            `${target.label} requires a manual agent launch. Start the agent on the node or use Jenkins.`
          );
        } else {
          void vscode.window.showInformationMessage(
            `${target.label} does not support launching from Jenkins.`
          );
        }
        return false;
      }
      if (result.status === "temporarily_offline") {
        void vscode.window.showInformationMessage(
          `${target.label} is temporarily offline. Bring it online before launching.`
        );
        return false;
      }
      void vscode.window.showInformationMessage(`${target.label} is already online.`);
      return false;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to launch ${target.label}: ${formatActionError(error)}`
      );
      return false;
    }
  }

  private formatOfflineReason(details?: JenkinsNodeDetails): string | undefined {
    const reason =
      details?.offlineCauseReason?.trim() ||
      details?.offlineCause?.description?.trim() ||
      details?.offlineCause?.shortDescription?.trim();
    return reason && reason.length > 0 ? reason : undefined;
  }
}
