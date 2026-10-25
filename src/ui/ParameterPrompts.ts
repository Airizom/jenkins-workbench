import * as vscode from "vscode";
import type { JobParameter } from "../jenkins/JenkinsDataService";

export async function promptForParameters(
  parameters: JobParameter[]
): Promise<URLSearchParams | undefined> {
  const payload = new URLSearchParams();

  for (const parameter of parameters) {
    const value = await promptForParameterValue(parameter);
    if (value === undefined) {
      return undefined;
    }
    payload.set(parameter.name, value);
  }

  return payload;
}

async function promptForParameterValue(parameter: JobParameter): Promise<string | undefined> {
  const prompt = `Parameter: ${parameter.name}`;
  const description = parameter.description;

  if (parameter.kind === "boolean") {
    return promptBooleanParameterValue(prompt, parameter.defaultValue);
  }

  if (parameter.kind === "choice" && parameter.choices?.length) {
    const defaultValue =
      typeof parameter.defaultValue === "string" ? parameter.defaultValue : undefined;
    return promptChoiceParameterValue(prompt, parameter.choices, defaultValue);
  }

  if (parameter.kind === "password") {
    return vscode.window.showInputBox({
      prompt,
      placeHolder: description,
      password: true,
      ignoreFocusOut: true
    });
  }

  return vscode.window.showInputBox({
    prompt,
    placeHolder: description,
    value: parameter.defaultValue !== undefined ? String(parameter.defaultValue) : undefined,
    ignoreFocusOut: true
  });
}

export async function promptBooleanParameterValue(
  prompt: string,
  defaultInput?: string | number | boolean | string[]
): Promise<string | undefined> {
  const defaultValue = normalizeBoolean(defaultInput);
  return promptChoiceParameterValue(
    prompt,
    ["true", "false"],
    defaultValue === undefined ? undefined : String(defaultValue)
  );
}

export async function promptChoiceParameterValue(
  prompt: string,
  choices: string[],
  defaultValue?: string
): Promise<string | undefined> {
  const quickPick = vscode.window.createQuickPick();
  quickPick.items = choices.map((label) => ({ label }));
  quickPick.placeholder = prompt;
  quickPick.ignoreFocusOut = true;
  const defaultItem = quickPick.items.find((item) => item.label === defaultValue);
  if (defaultItem) {
    quickPick.activeItems = [defaultItem];
  }

  return new Promise((resolve) => {
    const accept = quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0]?.label);
      quickPick.hide();
    });
    const hide = quickPick.onDidHide(() => {
      resolve(undefined);
      accept.dispose();
      hide.dispose();
      quickPick.dispose();
    });
    quickPick.show();
  });
}

function normalizeBoolean(value?: string | number | boolean | string[]): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined;
    }
    return normalizeBoolean(value[0]);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}
