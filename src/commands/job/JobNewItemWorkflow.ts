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

const NEW_ITEM_KIND_DEFINITIONS: readonly NewItemKindDefinition[] = [
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
];

const NEW_ITEM_KIND_BY_TYPE: Record<JenkinsItemCreateKind, NewItemKindDefinition> =
  Object.fromEntries(
    NEW_ITEM_KIND_DEFINITIONS.map((definition) => [definition.itemType, definition])
  ) as Record<JenkinsItemCreateKind, NewItemKindDefinition>;

export interface JobNewItemTarget {
  environment: JenkinsEnvironmentRef;
  parentUrl: string;
  locationLabel: string;
}

type NewItemCreateKindPick = vscode.QuickPickItem & {
  itemType: JenkinsItemCreateKind;
};

export interface JobNewItemWorkflowDependencies {
  dataService: JenkinsDataService;
  onEnvironmentChanged(environmentId: string): void;
}

export class JobNewItemWorkflow {
  constructor(private readonly deps: JobNewItemWorkflowDependencies) {}

  // fallow-ignore-next-line unused-class-member
  async run(target: JobNewItemTarget): Promise<void> {
    const kind = await promptNewItemKind();
    if (!kind) {
      return;
    }
    const kindDefinition = NEW_ITEM_KIND_BY_TYPE[kind];

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
        kind,
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

async function promptNewItemKind(): Promise<JenkinsItemCreateKind | undefined> {
  const picks: NewItemCreateKindPick[] = NEW_ITEM_KIND_DEFINITIONS.map(
    ({ label, description, itemType }) => ({ label, description, itemType })
  );
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select an item type to create",
    ignoreFocusOut: true
  });
  return pick?.itemType;
}
