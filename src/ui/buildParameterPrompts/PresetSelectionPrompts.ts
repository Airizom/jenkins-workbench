import * as vscode from "vscode";
import type { ParameterPresetSummary } from "../../storage/JenkinsParameterPresetStore";
import type {
  BuildParameterPromptOptions,
  BuildParameterPromptSelection
} from "./BuildParameterPromptTypes";

export async function choosePreset(
  options: BuildParameterPromptOptions
): Promise<BuildParameterPromptSelection | undefined> {
  while (true) {
    const presets = await options.presetStore.listPresets(
      options.environment.scope,
      options.environment.environmentId,
      options.jobUrl
    );

    const picks: Array<
      vscode.QuickPickItem & {
        action: "manual" | "preset" | "manage" | "cancel";
        presetId?: string;
      }
    > = [
      {
        label: "Manual entry",
        description: "Enter parameter values now",
        action: "manual"
      }
    ];

    for (const preset of presets) {
      picks.push({
        label: `Use preset: ${preset.name}`,
        description: new Date(preset.updatedAt).toLocaleString(),
        action: "preset",
        presetId: preset.id
      });
    }

    if (presets.length > 0) {
      picks.push({
        label: "Manage presets",
        description: "Rename or delete saved presets",
        action: "manage"
      });
    }

    picks.push({
      label: "Cancel",
      action: "cancel"
    });

    const pick = await vscode.window.showQuickPick(picks, {
      placeHolder: `Build parameters for ${options.jobLabel}`,
      ignoreFocusOut: true,
      matchOnDescription: true
    });

    if (!pick || pick.action === "cancel") {
      return undefined;
    }

    if (pick.action === "manual") {
      return {};
    }

    if (pick.action === "manage") {
      await managePresets(options, presets);
      continue;
    }

    if (!pick.presetId) {
      continue;
    }

    const preset = await options.presetStore.getPreset(
      options.environment.scope,
      options.environment.environmentId,
      options.jobUrl,
      pick.presetId
    );
    if (!preset) {
      void vscode.window.showWarningMessage("The selected preset is no longer available.");
      continue;
    }

    return {
      preset,
      presetSummary: {
        id: preset.id,
        name: preset.name,
        updatedAt: preset.updatedAt
      }
    };
  }
}

async function managePresets(
  options: BuildParameterPromptOptions,
  presets: ParameterPresetSummary[]
): Promise<void> {
  if (presets.length === 0) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: "Rename preset", action: "rename" as const },
      { label: "Delete preset", action: "delete" as const },
      { label: "Back", action: "back" as const }
    ],
    {
      placeHolder: "Manage parameter presets",
      ignoreFocusOut: true
    }
  );

  if (!action || action.action === "back") {
    return;
  }

  if (action.action === "rename") {
    const target = await selectPresetFromList("Select a preset to rename", presets);
    if (!target) {
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: "New preset name",
      value: target.name,
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value.trim()) {
          return "Preset name is required.";
        }
        return undefined;
      }
    });
    if (!name) {
      return;
    }

    try {
      const renamed = await options.presetStore.renamePreset(
        options.environment.scope,
        options.environment.environmentId,
        options.jobUrl,
        target.id,
        name
      );
      if (renamed) {
        void vscode.window.showInformationMessage(`Renamed preset to "${name.trim()}".`);
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to rename preset.";
      void vscode.window.showErrorMessage(message);
      return;
    }
  }

  const target = await selectPresetFromList("Select a preset to delete", presets);
  if (!target) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete preset "${target.name}"?`,
    { modal: true },
    "Delete"
  );
  if (confirm !== "Delete") {
    return;
  }

  const deleted = await options.presetStore.deletePreset(
    options.environment.scope,
    options.environment.environmentId,
    options.jobUrl,
    target.id
  );
  if (deleted) {
    void vscode.window.showInformationMessage(`Deleted preset "${target.name}".`);
  }
}

async function selectPresetFromList(
  placeHolder: string,
  presets: ParameterPresetSummary[]
): Promise<ParameterPresetSummary | undefined> {
  const pick = await vscode.window.showQuickPick(
    presets.map((preset) => ({
      label: preset.name,
      description: new Date(preset.updatedAt).toLocaleString(),
      preset
    })),
    {
      placeHolder,
      ignoreFocusOut: true,
      matchOnDescription: true
    }
  );
  return pick?.preset;
}
