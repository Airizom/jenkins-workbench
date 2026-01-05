import * as vscode from "vscode";
import { parseHeadersJson } from "../../jenkins/auth";
import type { JenkinsAuthConfig } from "../../jenkins/types";
import type { EnvironmentScope } from "../../storage/JenkinsEnvironmentStore";

export async function promptScope(): Promise<EnvironmentScope | undefined> {
  const pickItems: Array<vscode.QuickPickItem & { scope: EnvironmentScope }> = [
    {
      label: "Workspace",
      description: "Only available in this workspace",
      scope: "workspace"
    },
    {
      label: "Global",
      description: "Available in all workspaces",
      scope: "global"
    }
  ];

  const pick = await vscode.window.showQuickPick(pickItems, {
    placeHolder: "Choose where to store this environment",
    matchOnDescription: true
  });

  return pick?.scope;
}

export type EnvironmentAuthMode = JenkinsAuthConfig["type"];

export async function promptAuthMode(): Promise<EnvironmentAuthMode | undefined> {
  const pickItems: Array<vscode.QuickPickItem & { mode: EnvironmentAuthMode }> = [
    {
      label: "None",
      description: "No authentication headers",
      mode: "none"
    },
    {
      label: "Basic",
      description: "Username + API token",
      mode: "basic"
    },
    {
      label: "Bearer token",
      description: "Authorization: Bearer <token>",
      mode: "bearer"
    },
    {
      label: "Cookie header",
      description: "Send a Cookie header with every request",
      mode: "cookie"
    },
    {
      label: "Custom headers (JSON)",
      description: "Send arbitrary headers (e.g., Cookie, X-Forwarded-User)",
      mode: "headers"
    }
  ];

  const pick = await vscode.window.showQuickPick(pickItems, {
    placeHolder: "Choose an authentication method",
    matchOnDescription: true
  });

  return pick?.mode;
}

export async function promptRequiredInput(
  prompt: string,
  placeHolder?: string,
  password = false
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt,
    placeHolder,
    password,
    ignoreFocusOut: true,
    validateInput: (input) => (input.trim().length === 0 ? `${prompt} is required.` : undefined)
  });

  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function promptOptionalInput(
  prompt: string,
  placeHolder?: string,
  password = false
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    prompt,
    placeHolder,
    password,
    ignoreFocusOut: true
  });

  if (value === undefined) {
    return undefined;
  }

  return value.trim();
}

export async function promptHeadersJson(): Promise<Record<string, string> | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: "Custom headers (JSON object)",
    placeHolder: '{"Cookie":"JSESSIONID=...","X-Forwarded-User":"jenkins"}',
    ignoreFocusOut: true,
    validateInput: (input) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        return "Custom headers JSON is required.";
      }
      const validation = parseHeadersJson(trimmed);
      return validation.error ?? undefined;
    }
  });

  if (value === undefined) {
    return undefined;
  }

  const parsed = parseHeadersJson(value.trim());
  return parsed.headers;
}
