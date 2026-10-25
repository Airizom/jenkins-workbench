import * as vscode from "vscode";
import { type BulkCommandDependencies, createBulkCommandHandler } from "./BulkCommand";

export function registerQueueCommands(
  context: vscode.ExtensionContext,
  bulk: BulkCommandDependencies
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.cancelQueueItem",
      createBulkCommandHandler(bulk, "cancel")
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.cancelQueueItem.single",
      createBulkCommandHandler(bulk, "cancel", true)
    )
  );
}
