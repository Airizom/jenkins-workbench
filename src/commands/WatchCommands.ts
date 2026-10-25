import * as vscode from "vscode";
import { type BulkCommandDependencies, createBulkCommandHandler } from "./BulkCommand";

export function registerWatchCommands(
  context: vscode.ExtensionContext,
  bulk: BulkCommandDependencies
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.watchJob",
      createBulkCommandHandler(bulk, "watch")
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.unwatchJob",
      createBulkCommandHandler(bulk, "unwatch")
    )
  );
}
