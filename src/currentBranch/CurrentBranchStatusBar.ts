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
// Status bar items only support these two background colors. VS Code pairs each
// with its matching foreground, so `color` stays unset.
const WARNING_BACKGROUND = new vscode.ThemeColor("statusBarItem.warningBackground");
const ERROR_BACKGROUND = new vscode.ThemeColor("statusBarItem.errorBackground");

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
    this.item.backgroundColor = presentation.backgroundColor;
    this.item.tooltip = presentation.tooltip;
    this.item.show();
  }
}

function getStatusBarPresentation(state: CurrentBranchState):
  | {
      text: string;
      backgroundColor: vscode.ThemeColor | undefined;
      tooltip: vscode.StatusBarItem["tooltip"];
    }
  | undefined {
  switch (state.kind) {
    case "noGit":
    case "noRepository":
    case "ambiguousRepository":
    case "unlinked":
      return undefined;
    case "resolving":
      return {
        text: "$(sync~spin) Jenkins: Resolving current branch",
        backgroundColor: undefined,
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "matched":
      return {
        text: `${isCurrentBranchBuilding(state) ? "$(sync~spin)" : iconForMatchedState(state)} Jenkins: ${currentCommitLabel(state)}`,
        backgroundColor: backgroundForMatchedState(state),
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "branchMissing":
      return {
        text: `$(warning) Jenkins: ${state.branchName}`,
        backgroundColor: WARNING_BACKGROUND,
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "requestFailed":
      return {
        text: `$(warning) Jenkins: ${formatFailedStatusLabel(state)}`,
        backgroundColor: WARNING_BACKGROUND,
        tooltip: formatCurrentBranchTooltip(state)
      };
    case "detachedHead":
      return {
        text: "$(circle-slash) Jenkins",
        backgroundColor: undefined,
        tooltip: formatCurrentBranchTooltip(state)
      };
  }
}

function iconForMatchedState(state: Extract<CurrentBranchState, { kind: "matched" }>): string {
  const result = state.commit?.current?.build.result;
  return result === "SUCCESS" ? "$(pass)" : result === "FAILURE" ? "$(error)" : "$(question)";
}

function backgroundForMatchedState(
  state: Extract<CurrentBranchState, { kind: "matched" }>
): vscode.ThemeColor | undefined {
  const result = state.commit?.current?.build.result;
  if (result === "FAILURE") {
    return ERROR_BACKGROUND;
  }
  return result === "UNSTABLE" ? WARNING_BACKGROUND : undefined;
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
