import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsItemCreateKind } from "../../jenkins/types";
import { formatActionError } from "../CommandUtils";
import { getJobNameValidationError } from "./JobNameValidation";

interface NewItemKindDefinition {
  itemType: JenkinsItemCreateKind;
  label: string;
  description: string;
  promptLabel: string;
  defaultName: string;
}

const NEW_ITEM_KIND_DEFINITIONS = [
  {
    itemType: "job",
    label: "Job",
    description: "Freestyle job",
    promptLabel: "job",
    defaultName: "new-job"
  },
  {
    itemType: "pipeline",
    label: "Pipeline",
    description: "Pipeline job",
    promptLabel: "pipeline",
    defaultName: "new-pipeline"
  }
] as const satisfies readonly NewItemKindDefinition[];

export interface JobNewItemTarget {
  environment: JenkinsEnvironmentRef;
  parentUrl: string;
  locationLabel: string;
}

export interface JobNewItemWorkflowDependencies {
  dataService: JenkinsDataService;
  onEnvironmentChanged(environmentId: string): void;
}

export class JobNewItemWorkflow {
  constructor(private readonly deps: JobNewItemWorkflowDependencies) {}

  async run(target: JobNewItemTarget): Promise<void> {
    const kindDefinition = await promptNewItemKind();
    if (!kindDefinition) {
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: `Enter a name for the new ${kindDefinition.promptLabel}`,
      value: kindDefinition.defaultName,
      validateInput: (value) => getJobNameValidationError(value),
      ignoreFocusOut: true
    });
    if (!newName) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Create ${kindDefinition.promptLabel} "${newName}" in ${target.locationLabel}?`,
      { modal: true },
      "Create"
    );
    if (confirm !== "Create") {
      return;
    }

    try {
      const { newUrl } = await this.deps.dataService.createItem(
        kindDefinition.itemType,
        target.environment,
        target.parentUrl,
        newName
      );
      void vscode.window.showInformationMessage(
        `Created ${kindDefinition.promptLabel} "${newName}".${newUrl ? ` New job URL: ${newUrl}` : ""}`
      );
      this.deps.onEnvironmentChanged(target.environment.environmentId);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to create ${kindDefinition.promptLabel} "${newName}": ${formatActionError(error)}`
      );
    }
  }
}

async function promptNewItemKind(): Promise<NewItemKindDefinition | undefined> {
  return vscode.window.showQuickPick(NEW_ITEM_KIND_DEFINITIONS, {
    placeHolder: "Select an item type to create",
    ignoreFocusOut: true
  });
}
