import * as vscode from "vscode";
import {
  getExtensionConfiguration,
  getJenkinsfileValidationConfig
} from "../../extension/ExtensionConfig";
import type { JenkinsfileMatcher } from "../../validation/JenkinsfileMatcher";
import { isWorkspaceJenkinsfile } from "../../validation/WorkspaceJenkinsfile";

export class LocalJenkinsfileResolver {
  constructor(
    private readonly matcher: JenkinsfileMatcher,
    private readonly getPatterns: () => string[] = () =>
      getJenkinsfileValidationConfig(getExtensionConfiguration()).filePatterns
  ) {}

  async resolve(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (uri) {
      await this.requireDocument(uri);
      return uri;
    }

    const active = vscode.window.activeTextEditor?.document;
    if (active && isWorkspaceJenkinsfile(active, this.matcher)) {
      return active.uri;
    }

    const candidates = new Map<string, vscode.Uri>();
    const patterns = this.getPatterns();
    const searches = (vscode.workspace.workspaceFolders ?? []).flatMap((folder) =>
      patterns.map((pattern) =>
        vscode.workspace.findFiles(new vscode.RelativePattern(folder, pattern))
      )
    );
    for (const results of await Promise.all(searches)) {
      for (const candidate of results) {
        if (candidate.scheme === "file" && vscode.workspace.getWorkspaceFolder(candidate)) {
          candidates.set(candidate.toString(), candidate);
        }
      }
    }

    const uris = [...candidates.values()].sort((left, right) =>
      left.toString().localeCompare(right.toString())
    );
    if (uris.length === 0) {
      void vscode.window.showInformationMessage(
        "No workspace Jenkinsfile found. Open a workspace Jenkinsfile or check the configured Jenkinsfile patterns."
      );
      return undefined;
    }

    const selected =
      uris.length === 1
        ? uris[0]
        : (
            await vscode.window.showQuickPick(
              uris.map((candidate) => ({
                label: vscode.workspace.asRelativePath(candidate, true),
                uri: candidate
              })),
              {
                placeHolder: "Select the workspace Jenkinsfile to replay",
                matchOnDescription: true
              }
            )
          )?.uri;
    if (selected) {
      await this.requireDocument(selected);
    }
    return selected;
  }

  async readContent(uri: vscode.Uri): Promise<string> {
    const document = await this.requireDocument(uri);
    const text = document.getText();
    if (text.trim().length === 0) {
      throw new Error("The selected workspace Jenkinsfile is empty.");
    }
    return text;
  }

  private async requireDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(uri);
    if (!isWorkspaceJenkinsfile(document, this.matcher)) {
      throw new Error("Select a Jenkinsfile inside an open workspace folder to replay.");
    }
    return document;
  }
}
