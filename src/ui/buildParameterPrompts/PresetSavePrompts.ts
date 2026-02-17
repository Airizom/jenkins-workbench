import * as vscode from "vscode";
import type { JobParameter } from "../../jenkins/JenkinsDataService";
import type { ParameterPresetSummary } from "../../storage/JenkinsParameterPresetStore";
import type {
  BuildParameterPromptOptions,
  BuildParameterPromptValues
} from "./BuildParameterPromptTypes";

export async function selectTriggerMode(
  selectedPreset?: ParameterPresetSummary
): Promise<"trigger" | "saveNew" | "saveUpdate" | undefined> {
  const picks: Array<vscode.QuickPickItem & { mode: "trigger" | "saveNew" | "saveUpdate" }> = [
    {
      label: "Trigger",
      mode: "trigger"
    },
    {
      label: "Trigger + Save New Preset",
      mode: "saveNew"
    }
  ];

  if (selectedPreset) {
    picks.push({
      label: `Trigger + Update Preset: ${selectedPreset.name}`,
      mode: "saveUpdate"
    });
  }

  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Choose how to trigger this build",
    ignoreFocusOut: true
  });

  return pick?.mode;
}

export async function handlePresetSave(
  options: BuildParameterPromptOptions,
  input: {
    mode: "saveNew" | "saveUpdate";
    prompted: BuildParameterPromptValues;
    selectedPreset?: ParameterPresetSummary;
  }
): Promise<boolean> {
  const existing = await options.presetStore.listPresets(
    options.environment.scope,
    options.environment.environmentId,
    options.jobUrl
  );

  let targetId: string | undefined;
  let targetName: string;

  if (input.mode === "saveUpdate" && input.selectedPreset) {
    targetId = input.selectedPreset.id;
    targetName = input.selectedPreset.name;
  } else {
    const suggested = suggestPresetName(existing);
    const name = await vscode.window.showInputBox({
      prompt: "Preset name",
      value: suggested,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return "Preset name is required.";
        }
        return undefined;
      }
    });
    if (!name) {
      return false;
    }
    targetName = name.trim();
  }

  const nonSecretValues: Record<string, string | string[]> = {};
  const secretValues: Record<string, string | string[]> = {};

  for (const parameter of options.parameters) {
    const value = input.prompted.values[parameter.name];
    if (value === undefined) {
      continue;
    }

    if (!isSensitiveParameter(parameter)) {
      nonSecretValues[parameter.name] = value;
      continue;
    }

    const saveSecret = await vscode.window.showQuickPick(
      [
        {
          label: "Do not save (default)",
          save: false
        },
        {
          label: "Save securely",
          save: true
        }
      ],
      {
        placeHolder: `Store ${parameter.name} in SecretStorage?`,
        ignoreFocusOut: true
      }
    );

    if (!saveSecret) {
      return false;
    }

    if (saveSecret.save) {
      secretValues[parameter.name] = value;
    }
  }

  await options.presetStore.savePreset(
    options.environment.scope,
    options.environment.environmentId,
    options.jobUrl,
    {
      id: targetId,
      name: targetName,
      values: nonSecretValues,
      secretValues
    }
  );

  const actionText = targetId ? "Updated" : "Saved";
  void vscode.window.showInformationMessage(`${actionText} preset "${targetName}".`);
  return true;
}

function suggestPresetName(presets: ParameterPresetSummary[]): string {
  const used = new Set(presets.map((preset) => preset.name.toLocaleLowerCase()));
  for (let index = 1; index <= 99; index++) {
    const candidate = `Preset ${index}`;
    if (!used.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }
  return "Preset";
}

function isSensitiveParameter(parameter: JobParameter): boolean {
  if (parameter.isSensitive) {
    return true;
  }
  return parameter.kind === "password" || parameter.kind === "credentials";
}
