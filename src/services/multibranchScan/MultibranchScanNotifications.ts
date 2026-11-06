import * as vscode from "vscode";
import type { ExtensionRefreshHost } from "../../extension/ExtensionRefreshHost";
import { formatError } from "../../formatters/ErrorFormatters";
import { buildActionUrl } from "../../jenkins/urls";
import { openExternalHttpUrlWithWarning } from "../../ui/OpenExternalUrl";
import {
  formatMultibranchScanStatus,
  type MultibranchScanState,
  type MultibranchScanTarget
} from "./MultibranchScanState";

export const VIEW_SCAN_LOG = "View Scan Log";
const OPEN_IN_JENKINS = "Open in Jenkins";

export async function openMultibranchScanLog(target: MultibranchScanTarget): Promise<void> {
  await vscode.commands.executeCommand("jenkinsWorkbench.viewMultibranchScanLog", target);
}

export async function notifyMultibranchScan(state: MultibranchScanState): Promise<void> {
  const message = `${formatMultibranchScanStatus(state)} for ${state.target.label}.${state.detail ? ` ${state.detail}` : ""}`;
  const warning =
    state.phase === "unavailable" || (state.phase === "completed" && state.outcome !== "success");
  const choice = warning
    ? await vscode.window.showWarningMessage(message, VIEW_SCAN_LOG, OPEN_IN_JENKINS)
    : await vscode.window.showInformationMessage(message, VIEW_SCAN_LOG, OPEN_IN_JENKINS);
  if (choice === VIEW_SCAN_LOG) {
    await openMultibranchScanLog(state.target);
  } else if (choice === OPEN_IN_JENKINS) {
    await openExternalHttpUrlWithWarning(buildActionUrl(state.target.folderUrl, "indexing/"));
  }
}

export async function completeMultibranchScan(
  state: MultibranchScanState,
  refreshHost: Pick<ExtensionRefreshHost, "fullEnvironmentRefresh">,
  refreshCurrentBranch: () => Promise<unknown>
): Promise<void> {
  refreshHost.fullEnvironmentRefresh({
    environmentId: state.target.environment.environmentId,
    trigger: "system"
  });
  try {
    await refreshCurrentBranch();
  } catch (error) {
    console.warn("Unable to refresh the current branch after indexing.", formatError(error));
  }
  await notifyMultibranchScan(state);
}
