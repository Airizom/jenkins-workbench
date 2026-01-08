import * as vscode from "vscode";
import { formatCompletionStatus } from "../formatters/CompletionFormatters";
import type {
  CompletionNotification,
  PendingInputNotification,
  StatusNotifier
} from "../watch/StatusNotifier";

export class VscodeStatusNotifier implements StatusNotifier {
  notifyFailure(message: string): void {
    void vscode.window.showErrorMessage(message);
  }

  notifyRecovery(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  notifyWatchError(message: string): void {
    void vscode.window.showWarningMessage(message);
  }

  notifyCompletion(notification: CompletionNotification): void {
    const completion = formatCompletionStatus(notification.result, notification.color);
    const message = `${notification.jobLabel} completed (${completion.label}) in ${notification.environmentUrl}.`;
    if (completion.severity === "warning") {
      void vscode.window.showWarningMessage(message);
      return;
    }
    void vscode.window.showInformationMessage(message);
  }

  notifyPendingInput(notification: PendingInputNotification): void {
    const base = `${notification.jobLabel} is awaiting input in ${notification.environmentUrl}.`;
    const details = notification.inputMessage ? ` Prompt: ${notification.inputMessage}` : "";
    const message = `${base}${details}`;
    const action = "Open in Jenkins";
    void vscode.window
      .showInformationMessage(message, action)
      .then((selection) => {
        if (selection === action) {
          void vscode.env.openExternal(vscode.Uri.parse(notification.buildUrl));
        }
      });
  }
}
