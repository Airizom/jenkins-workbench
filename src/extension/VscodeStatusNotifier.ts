import * as vscode from "vscode";
import { formatCompletionStatus } from "../formatters/CompletionFormatters";
import { openExternalHttpUrlWithWarning } from "../ui/OpenExternalUrl";
import type {
  CompletionNotification,
  PendingInputNotification,
  StatusNotifier
} from "../watch/StatusNotifier";
import type { WatchNotificationOptions } from "./ExtensionConfig";

export class VscodeStatusNotifier implements StatusNotifier {
  constructor(private readonly getOptions: () => WatchNotificationOptions) {}

  private isEnabled(category: Exclude<keyof WatchNotificationOptions, "enabled">): boolean {
    const options = this.getOptions();
    return options.enabled && options[category];
  }

  notifyFailure(message: string): void {
    if (!this.isEnabled("failure")) {
      return;
    }
    void vscode.window.showErrorMessage(message);
  }

  notifyRecovery(message: string): void {
    if (!this.isEnabled("recovery")) {
      return;
    }
    void vscode.window.showInformationMessage(message);
  }

  notifyWatchError(message: string): void {
    if (!this.isEnabled("watchError")) {
      return;
    }
    void vscode.window.showWarningMessage(message);
  }

  notifyCompletion(notification: CompletionNotification): void {
    if (!this.isEnabled("completion")) {
      return;
    }
    const completion = formatCompletionStatus(notification.result, notification.color);
    const message = `${notification.jobLabel} completed (${completion.label}) in ${notification.environmentUrl}.`;
    if (completion.severity === "warning") {
      void vscode.window.showWarningMessage(message);
      return;
    }
    void vscode.window.showInformationMessage(message);
  }

  notifyPendingInput(notification: PendingInputNotification): void {
    if (!this.isEnabled("pendingInput")) {
      return;
    }
    const base = `${notification.jobLabel} is awaiting input in ${notification.environmentUrl}.`;
    const details = notification.inputMessage ? ` Prompt: ${notification.inputMessage}` : "";
    const message = `${base}${details}`;
    const action = "Open in Jenkins";
    void vscode.window.showInformationMessage(message, action).then((selection) => {
      if (selection === action) {
        void openExternalHttpUrlWithWarning(notification.buildUrl, {
          targetLabel: "Jenkins build URL",
          sourceLabel: "notification"
        });
      }
    });
  }
}
