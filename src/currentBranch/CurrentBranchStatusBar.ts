import * as vscode from "vscode";
import { currentCommitLabel } from "./CurrentBranchCommitPresentation";
import type { CurrentBranchJenkinsService } from "./CurrentBranchJenkinsService";
import {
  formatCurrentBranchTooltip,
  formatPullRequestLabel,
  isCurrentBranchBuilding
} from "./CurrentBranchPresentation";
import type { CurrentBranchState } from "./CurrentBranchTypes";

const ACTION_COMMAND = "jenkinsWorkbench.currentBranchActions";

export class CurrentBranchStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(service: CurrentBranchJenkinsService) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 9);
    this.item.command = ACTION_COMMAND;

    this.subscriptions.push(
      service.onDidChange((state) => {
        this.render(state);
      })
    );

    this.render(service.getState());
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private render(state: CurrentBranchState): void {
    const presentation = getStatusBarPresentation(state);
    if (!presentation) {
      this.item.hide();
      return;
    }

    this.item.text = presentation.text;
    this.item.color = presentation.color;
    this.item.tooltip = presentation.tooltip;
    this.item.show();
  }
}

function getStatusBarPresentation(
  state: CurrentBranchState
):
  | { text: string; color: vscode.ThemeColor | undefined; tooltip: vscode.StatusBarItem["tooltip"] }
  | undefined {
  switch (state.kind) {
    case "noGit":
    case "noRepository":
    case "ambiguousRepository":
    case "unlinked":
      return undefined;
    case "matched":
      return {
        text: `${isCurrentBranchBuilding(state) ? "$(sync~spin)" : iconForMatchedState(state)} Jenkins: ${formatMatchedStatusLabel(state)}`,
        color: colorForMatchedState(state),
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "branchMissing":
      return {
        text: `$(warning) Jenkins: ${state.branchName}`,
        color: new vscode.ThemeColor("statusBarItem.warningForeground"),
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "requestFailed":
      return {
        text: `$(warning) Jenkins: ${formatFailedStatusLabel(state)}`,
        color: new vscode.ThemeColor("statusBarItem.warningForeground"),
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "detachedHead":
      return {
        text: "$(circle-slash) Jenkins",
        color: new vscode.ThemeColor("statusBarItem.inactiveForeground"),
        tooltip: formatCurrentBranchTooltip(state)
      };
  }
}

function iconForMatchedState(state: Extract<CurrentBranchState, { kind: "matched" }>): string {
  const result = state.commit?.current?.build.result;
  return result === "SUCCESS" ? "$(pass)" : result === "FAILURE" ? "$(error)" : "$(question)";
}

function colorForMatchedState(
  state: Extract<CurrentBranchState, { kind: "matched" }>
): vscode.ThemeColor | undefined {
  const result = state.commit?.current?.build.result;
  return result === "FAILURE" || result === "UNSTABLE"
    ? new vscode.ThemeColor("statusBarItem.warningForeground")
    : undefined;
}

function formatMatchedStatusLabel(state: Extract<CurrentBranchState, { kind: "matched" }>): string {
  return currentCommitLabel(state);
}

function formatFailedStatusLabel(
  state: Extract<CurrentBranchState, { kind: "requestFailed" }>
): string {
  const pullRequestLabel = formatPullRequestLabel(state.selectedTarget?.pullRequest);
  if (state.selectedTarget?.kind === "pullRequest" && pullRequestLabel) {
    return pullRequestLabel;
  }

  return state.branchName ?? "Current Branch";
}
