import * as vscode from "vscode";
import type {
  CurrentBranchJenkinsService,
  CurrentBranchState
} from "./CurrentBranchJenkinsService";
import { formatCurrentBranchTooltip, isCurrentBranchBuilding } from "./CurrentBranchPresentation";

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
        text: `${isCurrentBranchBuilding(state) ? "$(sync~spin)" : iconForMatchedState(state)} Jenkins: ${state.branchName}`,
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
        text: `$(warning) Jenkins${state.branchName ? `: ${state.branchName}` : ""}`,
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
  if (state.jobColor?.endsWith("_anime")) {
    return "$(sync~spin)";
  }

  switch (state.jobColor?.replace(/_anime$/, "")) {
    case "blue":
      return "$(check)";
    case "yellow":
      return "$(warning)";
    case "red":
      return "$(error)";
    case "aborted":
    case "disabled":
    case "gray":
    case "grey":
      return "$(circle-slash)";
    default:
      return "$(symbol-misc)";
  }
}

function colorForMatchedState(
  state: Extract<CurrentBranchState, { kind: "matched" }>
): vscode.ThemeColor | undefined {
  const color = state.jobColor?.replace(/_anime$/, "");
  switch (color) {
    case "red":
      return new vscode.ThemeColor("statusBarItem.errorForeground");
    case "yellow":
      return new vscode.ThemeColor("statusBarItem.warningForeground");
    case "aborted":
    case "disabled":
    case "gray":
    case "grey":
      return new vscode.ThemeColor("statusBarItem.inactiveForeground");
    default:
      return undefined;
  }
}
