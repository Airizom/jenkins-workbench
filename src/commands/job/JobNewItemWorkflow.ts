import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsItemCreateKind } from "../../jenkins/types";
import { formatActionError } from "../CommandUtils";
import { getJobNameValidationError } from "./JobNameValidation";

const NEW_ITEM_LABELS: Record<JenkinsItemCreateKind, string> = {
  job: "job",
  pipeline: "pipeline"
};

const NEW_ITEM_DEFAULT_NAMES: Record<JenkinsItemCreateKind, string> = {
  job: "new-job",
  pipeline: "new-pipeline"
};

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

  async run(target: JobNewItemTarget): Promise<void> {
    const kind = await promptNewItemKind();
    if (!kind) {
      return;
    }

    const newName = await vscode.window.showInputBox({
      prompt: `Enter a name for the new ${NEW_ITEM_LABELS[kind]}`,
      value: NEW_ITEM_DEFAULT_NAMES[kind],
      validateInput: (value) => getJobNameValidationError(value),
      ignoreFocusOut: true
    });
    if (!newName) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Create ${NEW_ITEM_LABELS[kind]} "${newName}" in ${target.locationLabel}?`,
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
        `Created ${NEW_ITEM_LABELS[kind]} "${newName}".${newUrl ? ` New job URL: ${newUrl}` : ""}`
      );
      this.deps.onEnvironmentChanged(target.environment.environmentId);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to create ${NEW_ITEM_LABELS[kind]} "${newName}": ${formatActionError(error)}`
      );
    }
  }
}

async function promptNewItemKind(): Promise<JenkinsItemCreateKind | undefined> {
  const picks: NewItemCreateKindPick[] = [
    { label: "Job", description: "Freestyle job", itemType: "job" },
    { label: "Pipeline", description: "Pipeline job", itemType: "pipeline" }
  ];
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Select an item type to create",
    ignoreFocusOut: true
  });
  return pick?.itemType;
}
