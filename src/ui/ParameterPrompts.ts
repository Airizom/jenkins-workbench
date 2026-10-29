import * as vscode from "vscode";

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
