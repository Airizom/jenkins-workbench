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

export async function promptForParameterValue(
  parameter: JobParameter
): Promise<string | undefined> {
  const prompt = `Parameter: ${parameter.name}`;
  const description = parameter.description;

  if (parameter.kind === "boolean") {
    const defaultValue = normalizeBoolean(parameter.defaultValue);
    const pick = await vscode.window.showQuickPick(
      [
        { label: "true", picked: defaultValue === true },
        { label: "false", picked: defaultValue === false }
      ],
      { placeHolder: prompt, ignoreFocusOut: true }
    );
    return pick?.label;
  }

  if (parameter.kind === "choice" && parameter.choices?.length) {
    const defaultValue =
      typeof parameter.defaultValue === "string" ? parameter.defaultValue : undefined;
    const pick = await vscode.window.showQuickPick(
      parameter.choices.map((choice) => ({
        label: choice,
        picked: choice === defaultValue
      })),
      { placeHolder: prompt, ignoreFocusOut: true }
    );
    return pick?.label;
  }

  if (parameter.kind === "password") {
    return vscode.window.showInputBox({
      prompt,
      placeHolder: description,
      password: true,
      ignoreFocusOut: true
    });
  }

  const input = await vscode.window.showInputBox({
    prompt,
    placeHolder: description,
    value: parameter.defaultValue !== undefined ? String(parameter.defaultValue) : undefined,
    ignoreFocusOut: true
  });

  if (input === undefined) {
    return undefined;
  }

  return input;
}

export function normalizeBoolean(value?: string | number | boolean): boolean | undefined {
  if (value === undefined) {
    return undefined;
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
