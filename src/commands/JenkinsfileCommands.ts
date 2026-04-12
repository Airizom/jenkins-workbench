import * as vscode from "vscode";
import type { JenkinsfileStepCatalogService } from "../jenkinsfile/JenkinsfileStepCatalogService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsfileEnvironmentResolver } from "../validation/JenkinsfileEnvironmentResolver";
import type { JenkinsfileValidationCoordinator } from "../validation/JenkinsfileValidationCoordinator";
import {
  clearJenkinsfileDiagnostics,
  selectValidationEnvironment,
  showJenkinsfileValidationOutput,
  validateActiveJenkinsfile
} from "./jenkinsfile/JenkinsfileCommandHandlers";

export function registerJenkinsfileCommands(
  context: vscode.ExtensionContext,
  coordinator: JenkinsfileValidationCoordinator,
  resolver: JenkinsfileEnvironmentResolver,
  environmentStore: JenkinsEnvironmentStore,
  stepCatalogService: JenkinsfileStepCatalogService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jenkinsWorkbench.jenkinsfile.validateActive", () =>
      validateActiveJenkinsfile(coordinator)
    ),
    vscode.commands.registerCommand(
      "jenkinsWorkbench.jenkinsfile.selectValidationEnvironment",
      () => selectValidationEnvironment(resolver, environmentStore, coordinator, stepCatalogService)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.jenkinsfile.clearDiagnostics", () =>
      clearJenkinsfileDiagnostics(coordinator)
    ),
    vscode.commands.registerCommand("jenkinsWorkbench.jenkinsfile.showValidationOutput", () =>
      showJenkinsfileValidationOutput(coordinator)
    )
  );
}
