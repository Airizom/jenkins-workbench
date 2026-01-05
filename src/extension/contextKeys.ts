import * as vscode from "vscode";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";

export const NO_ENVIRONMENTS_CONTEXT_KEY = "jenkinsWorkbench.noEnvironments";

export async function syncNoEnvironmentsContext(store: JenkinsEnvironmentStore): Promise<boolean> {
  const environments = await store.listEnvironmentsWithScope();
  const noEnvironments = environments.length === 0;
  await vscode.commands.executeCommand("setContext", NO_ENVIRONMENTS_CONTEXT_KEY, noEnvironments);
  return noEnvironments;
}
