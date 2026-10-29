import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type {
  JenkinsInputParameterSubmission,
  PendingInputAction
} from "../jenkins/JenkinsDataService";
import type { JenkinsPendingInputApprovalRuntimeSurface } from "../jenkins/JenkinsDataServiceRuntimeSurfaces";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { buildPendingInputBrowserUrl } from "../jenkins/urls";
import { isSensitiveParameter } from "./buildParameterPrompts/ParameterSensitivity";
import {
  promptParameterValue,
  toInputSubmission
} from "./buildParameterPrompts/ParameterValuePrompts";
import {
  formatPendingInputParameterKind,
  getBrowserOnlyParameters
} from "./buildParameterPrompts/PendingInputParameterSupport";
import { openExternalHttpUrlWithWarning } from "./OpenExternalUrl";

export interface PendingInputActionOptions {
  dataService: JenkinsPendingInputApprovalRuntimeSurface;
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
    void vscode.window.showErrorMessage(
      `Failed to ${options.action} input for ${label}: ${formatActionError(error)}`
    );
    return false;
  }
}

async function approvePendingInput(
  options: PendingInputActionOptions,
  action: PendingInputAction,
  label: string
): Promise<boolean> {
  if (getBrowserOnlyParameters(action.parameters).length > 0) {
    await offerBrowserApproval(options, action);
    return false;
  }

  let params: JenkinsInputParameterSubmission[] | undefined;
  if (action.parameters.length > 0) {
    params = await promptInputParameters(options, action);
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

/** Prompts with the Trigger Build controls; resolves to `undefined` when any prompt is dismissed. */
async function promptInputParameters(
  options: PendingInputActionOptions,
  action: PendingInputAction
): Promise<JenkinsInputParameterSubmission[] | undefined> {
  // No job of our own: run parameters reach this point only when Jenkins named their project
  // (see requiresBrowserForPendingInput), and the run picker looks that project up instead.
  const context = {
    dataService: options.dataService,
    environment: options.environment,
    jobUrl: ""
  };
  const submissions: JenkinsInputParameterSubmission[] = [];
  for (const parameter of action.parameters) {
    // A second safeguard: the mapper already drops sensitive defaults, which wfapi reports in
    // plaintext, so a sensitive prompt always starts empty.
    const preset = isSensitiveParameter(parameter) ? "" : undefined;
    const value = await promptParameterValue(context, parameter, preset);
    if (value === undefined) {
      return undefined;
    }
    submissions.push(toInputSubmission(parameter, value));
  }
  return submissions;
}

const OPEN_IN_JENKINS_LABEL = "Open in Jenkins";

// An input step submits all of its parameters together, so one browser-only parameter means the
// whole input is approved on the Jenkins input page.
async function offerBrowserApproval(
  options: PendingInputActionOptions,
  action: PendingInputAction
): Promise<void> {
  const inputMessage = truncateForConfirmation(action.message.trim() || `Input ${action.id}`);
  const parameters = getBrowserOnlyParameters(action.parameters)
    .map((parameter) => `${parameter.name} (${formatPendingInputParameterKind(parameter)})`)
    .join(", ");
  const choice = await vscode.window.showWarningMessage(
    `“${inputMessage}” needs the Jenkins web page for: ${parameters}.`,
    { modal: true },
    OPEN_IN_JENKINS_LABEL
  );
  if (choice !== OPEN_IN_JENKINS_LABEL) {
    return;
  }
  await openExternalHttpUrlWithWarning(buildPendingInputBrowserUrl(options.buildUrl), {
    targetLabel: "Jenkins input page"
  });
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
