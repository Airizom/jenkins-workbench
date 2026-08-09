import * as vscode from "vscode";
import type { JobTreeItem, PipelineTreeItem } from "../tree/TreeItems";

export interface BuildDiagnosticCommandService {
  configure(target?: JobTreeItem | PipelineTreeItem): Promise<void>;
  refresh(): Promise<void>;
  showOutput(): void;
}

export function registerBuildDiagnosticCommands(
  context: vscode.ExtensionContext,
  service: BuildDiagnosticCommandService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jenkinsWorkbench.configureBuildDiagnostics",
      (target?: JobTreeItem | PipelineTreeItem) => service.configure(target)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.refreshBuildDiagnostics", () =>
      service.refresh()
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.showBuildDiagnosticOutput", () => {
      service.showOutput();
    })
  );
}
