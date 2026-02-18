import * as vscode from "vscode";
import type { ExtensionContainer } from "../extension/container/ExtensionContainer";
import { JenkinsTaskProvider } from "./JenkinsTaskProvider";
import { JENKINS_TASK_TYPE } from "./JenkinsTaskTypes";

export function registerJenkinsTasks(
  context: vscode.ExtensionContext,
  container: ExtensionContainer
): void {
  const environmentStore = container.get("environmentStore");
  const dataService = container.get("dataService");
  const refreshHost = container.get("refreshHost");
  const provider = new JenkinsTaskProvider(environmentStore, dataService, refreshHost);
  context.subscriptions.push(vscode.tasks.registerTaskProvider(JENKINS_TASK_TYPE, provider));
}
