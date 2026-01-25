import * as vscode from "vscode";
import type { JenkinsEnvironmentStore } from "../storage/JenkinsEnvironmentStore";
import type { JenkinsfileMatcher } from "../validation/JenkinsfileMatcher";

export const NO_ENVIRONMENTS_CONTEXT_KEY = "jenkinsWorkbench.noEnvironments";
export const JENKINSFILE_ACTIVE_CONTEXT_KEY = "jenkinsWorkbench.jenkinsfileActive";

export async function syncNoEnvironmentsContext(store: JenkinsEnvironmentStore): Promise<boolean> {
  const environments = await store.listEnvironmentsWithScope();
  const noEnvironments = environments.length === 0;
  await vscode.commands.executeCommand("setContext", NO_ENVIRONMENTS_CONTEXT_KEY, noEnvironments);
  return noEnvironments;
}

export async function syncJenkinsfileContext(
  matcher: JenkinsfileMatcher,
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
): Promise<boolean> {
  const isJenkinsfile = editor ? matcher.matches(editor.document) : false;
  await vscode.commands.executeCommand("setContext", JENKINSFILE_ACTIVE_CONTEXT_KEY, isJenkinsfile);
  return isJenkinsfile;
}
