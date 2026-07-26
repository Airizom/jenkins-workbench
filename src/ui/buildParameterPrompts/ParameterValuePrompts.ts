import { basename } from "node:path";
import * as vscode from "vscode";
import type { BuildParameterPayload, JobParameter } from "../../jenkins/JenkinsDataService";
import { promptBooleanParameterValue, promptChoiceParameterValue } from "../ParameterPrompts";
import type {
  BuildParameterPromptOptions,
  BuildParameterPromptValues,
  ParameterValue
} from "./BuildParameterPromptTypes";
import { isSensitiveParameter } from "./ParameterSensitivity";
import { resolveMultiDefaultValue, resolveSingleDefaultValue } from "./ParameterValueDefaults";
import { fetchRunBuildChoices } from "./RunParameterLookup";

export async function promptParameterValues(
  options: BuildParameterPromptOptions,
  presetValues?: Record<string, ParameterValue>
): Promise<BuildParameterPromptValues | undefined> {
  const payload: BuildParameterPayload = {
    fields: [],
    files: []
  };
  const values: Record<string, ParameterValue> = {};

  for (const parameter of options.parameters) {
    const presetValue = presetValues?.[parameter.name];
    const value = await promptParameterValue(options, parameter, presetValue);
    if (value === undefined) {
      return undefined;
    }

    values[parameter.name] = value;
    addParameterToPayload(payload, parameter, value);
  }

  return { payload, values };
}

function addParameterToPayload(
  payload: BuildParameterPayload,
  parameter: JobParameter,
  value: ParameterValue
): void {
  if (typeof value === "string") {
    if (parameter.kind !== "file") {
      payload.fields.push({ name: parameter.name, value });
      return;
    }

    const filePath = value.trim();
    if (filePath.length > 0) {
      payload.files.push({
        name: parameter.name,
        filePath,
        fileName: basename(filePath)
      });
    }
    return;
  }

  if (value.length > 0) {
    const delimiter = parameter.multiSelectDelimiter?.trim();
    if (delimiter) {
      payload.fields.push({
        name: parameter.name,
        value: value.join(delimiter)
      });
      return;
    }

    for (const entry of value) {
      payload.fields.push({ name: parameter.name, value: entry });
    }
  }
}

async function promptParameterValue(
  options: BuildParameterPromptOptions,
  parameter: JobParameter,
  presetValue?: ParameterValue
): Promise<ParameterValue | undefined> {
  const prompt = `Parameter: ${parameter.name}`;
  const description = parameter.description;

  if (parameter.kind === "boolean") {
    return promptBooleanParameterValue(
      prompt,
      typeof presetValue === "string" ? presetValue : parameter.defaultValue
    );
  }

  if (parameter.kind === "choice" && parameter.choices?.length) {
    const defaultValue = resolveSingleDefaultValue(presetValue, parameter.defaultValue);
    return promptChoiceParameterValue(prompt, parameter.choices, defaultValue);
  }

  if (parameter.kind === "multiChoice" && parameter.choices?.length) {
    const defaultValues = resolveMultiDefaultValue(
      presetValue,
      parameter.defaultValue,
      parameter.multiSelectDelimiter
    );
    const picks = await vscode.window.showQuickPick(
      parameter.choices.map((choice) => ({
        label: choice,
        picked: defaultValues.includes(choice)
      })),
      {
        placeHolder: prompt,
        ignoreFocusOut: true,
        canPickMany: true
      }
    );
    if (!picks) {
      return undefined;
    }
    return picks.map((pick) => pick.label);
  }

  if (isSensitiveParameter(parameter)) {
    return promptForSensitiveParameter(parameter, presetValue);
  }

  if (parameter.kind === "run") {
    return promptForRunParameter(options, parameter, presetValue);
  }

  if (parameter.kind === "file") {
    return promptForFileParameter(parameter, presetValue);
  }

  if (parameter.kind === "text") {
    return promptForTextParameter(parameter, presetValue);
  }

  const input = await vscode.window.showInputBox({
    prompt,
    placeHolder: description,
    value: resolveSingleDefaultValue(presetValue, parameter.defaultValue),
    ignoreFocusOut: true
  });

  if (input === undefined) {
    return undefined;
  }

  return input;
}

async function promptForSensitiveParameter(
  parameter: JobParameter,
  presetValue?: ParameterValue
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: `Parameter: ${parameter.name}`,
    placeHolder: parameter.description,
    password: true,
    ignoreFocusOut: true,
    value: resolveSingleDefaultValue(presetValue, parameter.defaultValue)
  });
}

async function promptForRunParameter(
  options: BuildParameterPromptOptions,
  parameter: JobParameter,
  presetValue?: ParameterValue
): Promise<string | undefined> {
  const prompt = `Parameter: ${parameter.name}`;
  const defaultValue = resolveSingleDefaultValue(presetValue, parameter.defaultValue);
  const candidates = await fetchRunBuildChoices(options, parameter);

  if (candidates.length === 0) {
    return vscode.window.showInputBox({
      prompt,
      placeHolder: parameter.runProjectName
        ? `Enter run value for ${parameter.runProjectName}`
        : "Enter run value",
      value: defaultValue,
      ignoreFocusOut: true
    });
  }

  const picks: Array<vscode.QuickPickItem & { value?: string; mode: "existing" | "manual" }> =
    candidates.map((candidate) => ({
      label: `#${candidate.number}`,
      description: candidate.description,
      detail: candidate.detail,
      value: String(candidate.number),
      mode: "existing"
    }));

  picks.push({
    label: "Enter manually...",
    mode: "manual"
  });

  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: prompt,
    ignoreFocusOut: true
  });

  if (!selected) {
    return undefined;
  }

  if (selected.mode === "existing") {
    return selected.value;
  }

  return vscode.window.showInputBox({
    prompt,
    value: defaultValue,
    ignoreFocusOut: true
  });
}

async function promptForFileParameter(
  parameter: JobParameter,
  presetValue?: ParameterValue
): Promise<string | undefined> {
  const defaultPath = resolveSingleDefaultValue(presetValue, parameter.defaultValue)?.trim();

  if (defaultPath) {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: "Use saved file",
          description: defaultPath,
          action: "use" as const
        },
        {
          label: "Choose file...",
          action: "choose" as const
        },
        {
          label: "Clear value",
          action: "clear" as const
        }
      ],
      {
        placeHolder: `Parameter: ${parameter.name}`,
        ignoreFocusOut: true,
        matchOnDescription: true
      }
    );

    if (!pick) {
      return undefined;
    }

    if (pick.action === "use") {
      return defaultPath;
    }

    if (pick.action === "clear") {
      return "";
    }
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: `Use for ${parameter.name}`,
    title: `Select file for ${parameter.name}`
  });

  if (!selected || selected.length === 0) {
    return undefined;
  }

  return selected[0].fsPath;
}

async function promptForTextParameter(
  parameter: JobParameter,
  presetValue?: ParameterValue
): Promise<string | undefined> {
  const defaultValue = resolveSingleDefaultValue(presetValue, parameter.defaultValue) ?? "";
  const document = await vscode.workspace.openTextDocument({
    language: "plaintext",
    content: defaultValue
  });
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false
  });

  const action = await vscode.window.showInformationMessage(
    `Edit text for ${parameter.name}, then choose an action.`,
    "Use text",
    "Cancel"
  );

  if (action !== "Use text") {
    return undefined;
  }

  return document.getText();
}
