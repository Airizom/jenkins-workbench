import * as vscode from "vscode";
import type { JenkinsfileMatcher } from "./JenkinsfileMatcher";

export function isWorkspaceJenkinsfile(
  document: vscode.TextDocument,
  matcher: JenkinsfileMatcher
): boolean {
  return (
    document.uri.scheme === "file" &&
    Boolean(vscode.workspace.getWorkspaceFolder(document.uri)) &&
    matcher.matches(document)
  );
}
