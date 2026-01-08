import * as vscode from "vscode";
import type { PendingInputAction } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { BuildActionError } from "../jenkins/errors";
import { promptForParameters } from "./ParameterPrompts";

export interface PendingInputActionService {
  getPendingInputActions(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh" }
  ): Promise<PendingInputAction[]>;
  approveInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    options?: { params?: URLSearchParams; proceedText?: string; proceedUrl?: string }
  ): Promise<void>;
  rejectInput(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    inputId: string,
    abortUrl?: string
  ): Promise<void>;
}

export interface PendingInputActionOptions {
  dataService: PendingInputActionService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label?: string;
  inputId?: string;
  action: "approve" | "reject";
  onRefresh?: () => void | Promise<void>;
}

export async function handlePendingInputAction(
  options: PendingInputActionOptions
): Promise<boolean> {
  const label = options.label ?? "build";

  try {
    const actions = await options.dataService.getPendingInputActions(
      options.environment,
      options.buildUrl,
      { mode: "refresh" }
    );
    const action = await resolvePendingInputAction(
      actions,
      options.inputId,
      label,
      options.action
    );
    if (!action) {
      return false;
    }

    if (options.action === "approve") {
      let params: URLSearchParams | undefined;
      if (action.parameters.length > 0) {
        params = await promptForParameters(action.parameters);
        if (!params) {
          return false;
        }
      }
      await options.dataService.approveInput(options.environment, options.buildUrl, action.id, {
        params,
        proceedText: action.proceedText,
        proceedUrl: action.proceedUrl
      });
      void vscode.window.showInformationMessage(`Approved input for ${label}.`);
    } else {
      await options.dataService.rejectInput(
        options.environment,
        options.buildUrl,
        action.id,
        action.abortUrl
      );
      void vscode.window.showInformationMessage(`Rejected input for ${label}.`);
    }

    if (options.onRefresh) {
      await options.onRefresh();
    }
    return true;
  } catch (error) {
    const verb = options.action === "approve" ? "approve" : "reject";
    void vscode.window.showErrorMessage(
      `Failed to ${verb} input for ${label}: ${formatActionError(error)}`
    );
    return false;
  }
}

async function resolvePendingInputAction(
  actions: PendingInputAction[],
  inputId: string | undefined,
  label: string,
  action: "approve" | "reject"
): Promise<PendingInputAction | undefined> {
  if (actions.length === 0) {
    void vscode.window.showInformationMessage(`No pending inputs for ${label}.`);
    return undefined;
  }

  if (inputId) {
    const match = actions.find((entry) => entry.id === inputId);
    if (!match) {
      void vscode.window.showInformationMessage("No matching pending input was found.");
    }
    return match;
  }

  if (actions.length === 1) {
    return actions[0];
  }

  const picks = actions.map((entry) => ({
    label: entry.message || `Input ${entry.id}`,
    description: entry.submitter ? `Submitter: ${entry.submitter}` : undefined,
    detail:
      entry.parameters.length > 0
        ? `Parameters: ${entry.parameters.map((param) => param.name).join(", ")}`
        : "No parameters",
    action: entry
  }));

  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: `Select a pending input to ${action} for ${label}`,
    ignoreFocusOut: true
  });

  return pick?.action;
}

function formatActionError(error: unknown): string {
  if (error instanceof BuildActionError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error.";
}
