import * as vscode from "vscode";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import { JenkinsTaskProvider } from "./JenkinsTaskProvider";
import type { JenkinsTaskRefreshHost } from "./JenkinsTaskRefreshHost";
import { JENKINS_TASK_TYPE } from "./JenkinsTaskTypes";

export function registerJenkinsTasks(
  context: vscode.ExtensionContext,
  environmentStore: JenkinsEnvironmentStore,
  dataService: JenkinsDataService,
  refreshHost: JenkinsTaskRefreshHost
): void {
  const provider = new JenkinsTaskProvider(environmentStore, dataService, refreshHost);
  context.subscriptions.push(vscode.tasks.registerTaskProvider(JENKINS_TASK_TYPE, provider));
}
