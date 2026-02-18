import * as vscode from "vscode";
import type { ExtensionContainer } from "../extension/container/ExtensionContainer";
import { JenkinsTaskProvider } from "./JenkinsTaskProvider";
import { JENKINS_TASK_TYPE } from "./JenkinsTaskTypes";

export function registerJenkinsTasks(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const provider = new JenkinsTaskProvider(
    container.get("environmentStore"),
    container.get("dataService"),
    container.get("refreshHost")
  );
  context.subscriptions.push(vscode.tasks.registerTaskProvider(JENKINS_TASK_TYPE, provider));
}
