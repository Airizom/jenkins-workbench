import * as vscode from "vscode";
import type { EnvironmentScopedRefreshHost } from "../extension/ExtensionRefreshHost";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { formatNodeOfflineReason } from "../jenkins/NodeFormatters";
import type { JenkinsNodeDetails } from "../jenkins/types";

export type NodeActionTarget = {
  environment: JenkinsEnvironmentRef;
  nodeUrl: string;
  label: string;
  /** Busy executor count when known, so the offline prompt can mention running builds. */
  busyExecutors?: number;
};

export interface NodeActionRefreshHost extends EnvironmentScopedRefreshHost {}

export class NodeActionService {
  constructor(private readonly dataService: JenkinsDataService) {}

  /**
   * Confirms taking the node offline and asks for the optional reason. The
   * prompt states the consequence (and running builds, when `busyExecutors` is
   * known). Resolves `undefined` when the user cancels, so callers can show
   * progress only after the user confirms.
   */
  async promptOfflineReason(
    label: string,
    busyExecutors?: number
  ): Promise<{ reason?: string } | undefined> {
    const reasonInput = await vscode.window.showInputBox({
      title: `Take ${label} offline`,
      prompt: formatTakeOfflinePrompt(label, busyExecutors),
      placeHolder: "Offline reason (optional)",
      ignoreFocusOut: true
    });
    if (reasonInput === undefined) {
      return undefined;
    }
    const trimmedReason = reasonInput.trim();
    return { reason: trimmedReason.length > 0 ? trimmedReason : undefined };
  }

  /**
   * Takes the node temporarily offline. Pass `confirmed` when the reason was
   * already collected with `promptOfflineReason`; otherwise this prompts first.
   */
  // fallow-ignore-next-line unused-class-member -- invoked through node action handlers
  async takeNodeOffline(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost,
    confirmed?: { reason?: string }
  ): Promise<boolean> {
    const input = confirmed ?? (await this.promptOfflineReason(target.label, target.busyExecutors));
    if (!input) {
      return false;
    }
    const reason = input.reason;

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
        refreshHost?.fullEnvironmentRefresh({ environmentId: target.environment.environmentId });
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

  // fallow-ignore-next-line unused-class-member -- invoked through node action handlers
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
        return this.handleSuccessfulOnlineAction(target, result.details, refreshHost, {
          stillTemporaryMessage: `${target.label} is still temporarily offline. Use Jenkins to update its status.`,
          stillOfflineAction: "Cleared temporary offline",
          onlineMessage: `Brought ${target.label} online.`
        });
      }
      if (result.status === "not_temporarily_offline") {
        const offlineReason = formatNodeOfflineReason(result.details);
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

  // fallow-ignore-next-line unused-class-member -- invoked through node action handlers
  async launchNodeAgent(
    target: NodeActionTarget,
    refreshHost?: NodeActionRefreshHost
  ): Promise<boolean> {
    try {
      const result = await this.dataService.launchNodeAgent(target.environment, target.nodeUrl);
      if (result.status === "launched") {
        return this.handleSuccessfulOnlineAction(target, result.details, refreshHost, {
          stillOfflineAction: "Launch requested",
          onlineMessage: `Launched ${target.label}.`
        });
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

  private handleSuccessfulOnlineAction(
    target: NodeActionTarget,
    details: JenkinsNodeDetails,
    refreshHost: NodeActionRefreshHost | undefined,
    messages: {
      stillTemporaryMessage?: string;
      stillOfflineAction: string;
      onlineMessage: string;
    }
  ): boolean {
    if (details.temporarilyOffline && messages.stillTemporaryMessage) {
      void vscode.window.showInformationMessage(messages.stillTemporaryMessage);
    } else if (details.offline) {
      void vscode.window.showInformationMessage(
        this.formatStillOfflineMessage(messages.stillOfflineAction, target, details)
      );
    } else {
      void vscode.window.showInformationMessage(messages.onlineMessage);
    }
    refreshHost?.fullEnvironmentRefresh({ environmentId: target.environment.environmentId });
    return true;
  }

  private formatStillOfflineMessage(
    actionLabel: string,
    target: NodeActionTarget,
    details: JenkinsNodeDetails
  ): string {
    const offlineReason = formatNodeOfflineReason(details);
    const reasonLabel = offlineReason ? ` Reason: ${offlineReason}` : "";
    return `${actionLabel} for ${target.label}, but it is still offline.${reasonLabel}`;
  }
}

export function formatTakeOfflinePrompt(label: string, busyExecutors?: number): string {
  const parts = [`New builds won't be scheduled on ${label}; running builds continue.`];
  if (busyExecutors !== undefined && Number.isFinite(busyExecutors) && busyExecutors > 0) {
    parts.push(`${busyExecutors} executor${busyExecutors === 1 ? " is" : "s are"} busy right now.`);
  }
  parts.push("Press Enter to confirm. The reason is optional.");
  return parts.join(" ");
}
