import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { PendingInputAction } from "../jenkins/JenkinsDataService";
import type { JenkinsPendingInputActionRuntimeSurface } from "../jenkins/JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { promptForParameters } from "./ParameterPrompts";

export interface PendingInputActionOptions {
  dataService: JenkinsPendingInputActionRuntimeSurface;
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
    const action = await resolvePendingInputAction(actions, options.inputId, label, options.action);
    if (!action) {
      return false;
    }

    const submitted =
      options.action === "approve"
        ? await approvePendingInput(options, action, label)
        : await rejectPendingInput(options, action, label);
    if (!submitted) {
      return false;
    }

    await refreshAfterInputAction(options.onRefresh, label);
    return true;
  } catch (error) {
    const verb = options.action === "approve" ? "approve" : "reject";
    void vscode.window.showErrorMessage(
      `Failed to ${verb} input for ${label}: ${formatActionError(error)}`
    );
    return false;
  }
}

async function approvePendingInput(
  options: PendingInputActionOptions,
  action: PendingInputAction,
  label: string
): Promise<boolean> {
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
  return true;
}

async function rejectPendingInput(
  options: PendingInputActionOptions,
  action: PendingInputAction,
  label: string
): Promise<boolean> {
  if (!(await confirmRejectInput(action, label))) {
    return false;
  }
  await options.dataService.rejectInput(
    options.environment,
    options.buildUrl,
    action.id,
    action.abortUrl
  );
  void vscode.window.showInformationMessage(`Rejected input for ${label}.`);
  return true;
}

// A refresh failure must not report the already-submitted input action as failed.
async function refreshAfterInputAction(
  onRefresh: PendingInputActionOptions["onRefresh"],
  label: string
): Promise<void> {
  if (!onRefresh) {
    return;
  }
  try {
    await onRefresh();
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Input action for ${label} succeeded, but refresh failed: ${formatActionError(error)}`
    );
  }
}

const REJECT_CONFIRM_LABEL = "Reject";
const MAX_CONFIRM_MESSAGE_CHARS = 120;

// Rejecting an input aborts the build, so it always needs an explicit confirmation.
async function confirmRejectInput(action: PendingInputAction, label: string): Promise<boolean> {
  const inputMessage = truncateForConfirmation(action.message.trim() || `Input ${action.id}`);
  const choice = await vscode.window.showWarningMessage(
    `Reject input “${inputMessage}” for ${label}? The build will be aborted.`,
    { modal: true },
    REJECT_CONFIRM_LABEL
  );
  return choice === REJECT_CONFIRM_LABEL;
}

function truncateForConfirmation(value: string): string {
  if (value.length <= MAX_CONFIRM_MESSAGE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_CONFIRM_MESSAGE_CHARS - 1).trimEnd()}…`;
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
