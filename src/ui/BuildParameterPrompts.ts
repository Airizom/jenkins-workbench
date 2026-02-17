import * as vscode from "vscode";
import { choosePreset } from "./buildParameterPrompts/PresetSelectionPrompts";
import { promptParameterValues } from "./buildParameterPrompts/ParameterValuePrompts";
import { handlePresetSave, selectTriggerMode } from "./buildParameterPrompts/PresetSavePrompts";
import type {
  BuildParameterPromptOptions,
  BuildParameterPromptResult
} from "./buildParameterPrompts/BuildParameterPromptTypes";

export type { BuildParameterPromptResult } from "./buildParameterPrompts/BuildParameterPromptTypes";

export async function promptForBuildParameters(
  options: BuildParameterPromptOptions
): Promise<BuildParameterPromptResult | undefined> {
  const presetSelection = await choosePreset(options);
  if (!presetSelection) {
    return undefined;
  }

  const prompted = await promptParameterValues(options, presetSelection.preset?.values);
  if (!prompted) {
    return undefined;
  }

  const triggerMode = await selectTriggerMode(presetSelection.presetSummary);
  if (!triggerMode) {
    return undefined;
  }

  if (triggerMode !== "trigger") {
    const saved = await handlePresetSave(options, {
      mode: triggerMode,
      prompted,
      selectedPreset: presetSelection.presetSummary
    });
    if (!saved) {
      const decision = await vscode.window.showWarningMessage(
        "Unable to save parameter preset. Trigger build without saving?",
        "Trigger without saving",
        "Cancel"
      );
      if (decision !== "Trigger without saving") {
        return undefined;
      }
    }
  }

  return {
    payload: prompted.payload,
    allowEmptyParams: true
  };
}
