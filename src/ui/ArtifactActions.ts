import * as path from "node:path";
import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { JenkinsMaxBytesError } from "../jenkins/errors";
import type {
  ArtifactActionService,
  ArtifactDownloadActionRequest
} from "../services/ArtifactActionService";
import { ArtifactStorageError } from "../services/ArtifactStorageService";
import type { ArtifactPreviewer } from "./ArtifactPreviewer";
import type { ArtifactActionOptionsProvider } from "./ArtifactActionHandler";

export interface ArtifactActionRequest {
  action: "preview" | "download";
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildNumber?: number;
  relativePath: string;
  fileName?: string;
  jobNameHint?: string;
}

export async function runArtifactAction(
  actionService: ArtifactActionService,
  previewer: ArtifactPreviewer,
  request: ArtifactActionRequest,
  optionsProvider: ArtifactActionOptionsProvider
): Promise<void> {
  const label = request.fileName || path.basename(request.relativePath) || request.relativePath;

  try {
    if (request.action === "preview") {
      await previewer.preview({
        environment: request.environment,
        buildUrl: request.buildUrl,
        relativePath: request.relativePath,
        fileName: request.fileName
      });
      return;
    }

    const workspaceFolder = await pickWorkspaceFolder();
    if (!workspaceFolder) {
      return;
    }
    if (workspaceFolder.uri.scheme !== "file") {
      void vscode.window.showInformationMessage(
        "Artifact downloads are only supported for file-based workspaces."
      );
      return;
    }

    const options = optionsProvider(workspaceFolder);
    const downloadRequest: ArtifactDownloadActionRequest = {
      environment: request.environment,
      buildUrl: request.buildUrl,
      buildNumber: request.buildNumber,
      relativePath: request.relativePath,
      fileName: request.fileName,
      jobNameHint: request.jobNameHint
    };
    const result = await actionService.execute(
      downloadRequest,
      options,
      workspaceFolder.uri.fsPath
    );

    void vscode.window.showInformationMessage(
      `Downloaded ${result.label} to ${result.targetPath}.`
    );
  } catch (error) {
    const actionLabel = request.action === "preview" ? "preview" : "download";
    void vscode.window.showErrorMessage(
      `Failed to ${actionLabel} ${label}: ${formatArtifactError(error)}`
    );
  }
}

async function pickWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    void vscode.window.showInformationMessage("Open a workspace folder to save Jenkins artifacts.");
    return undefined;
  }
  if (folders.length === 1) {
    return folders[0];
  }
  return vscode.window.showWorkspaceFolderPick({
    placeHolder: "Select a workspace folder for downloaded artifacts"
  });
}

function formatArtifactError(error: unknown): string {
  if (error instanceof ArtifactStorageError) {
    return error.message;
  }
  if (error instanceof JenkinsMaxBytesError) {
    const maxMegabytes = Math.max(1, Math.round(error.maxBytes / (1024 * 1024)));
    return `Artifact exceeds the download size limit of ${maxMegabytes} MB. Update jenkinsWorkbench.artifactMaxDownloadMb to preview or download larger files.`;
  }
  return error instanceof Error ? error.message : "Unexpected error.";
}
