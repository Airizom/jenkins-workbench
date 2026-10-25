import * as path from "node:path";
import type { WorkspaceFolder } from "vscode";
import * as vscode from "vscode";
import { JenkinsMaxBytesError } from "../jenkins/errors";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import {
  ArtifactStorageError,
  type ArtifactStorageService
} from "../services/ArtifactStorageService";
import type { ArtifactPreviewer } from "./ArtifactPreviewer";

interface ArtifactBuildContext {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildNumber?: number;
  jobNameHint?: string;
}

export type ArtifactActionRequest = ArtifactBuildContext &
  (
    | { action: "preview" | "download"; relativePath: string; fileName?: string }
    | { action: "downloadAll" }
  );

export interface ArtifactActionHandler {
  handle(request: ArtifactActionRequest): Promise<void>;
}

export interface ArtifactActionOptions {
  downloadRoot: string;
  maxBytes?: number;
}

export type ArtifactActionOptionsProvider = (
  workspaceFolder: WorkspaceFolder
) => ArtifactActionOptions;

export class DefaultArtifactActionHandler implements ArtifactActionHandler {
  constructor(
    private readonly storageService: ArtifactStorageService,
    private readonly previewer: ArtifactPreviewer,
    private readonly optionsProvider: ArtifactActionOptionsProvider
  ) {}

  async handle(request: ArtifactActionRequest): Promise<void> {
    const label =
      request.action === "downloadAll"
        ? "all artifacts as ZIP"
        : request.fileName || path.basename(request.relativePath) || request.relativePath;

    try {
      if (request.action === "preview") {
        await this.previewer.preview({
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

      const options = this.optionsProvider(workspaceFolder);
      const context = {
        environment: request.environment,
        buildUrl: request.buildUrl,
        buildNumber: request.buildNumber,
        jobNameHint: request.jobNameHint,
        workspaceRoot: workspaceFolder.uri.fsPath,
        downloadRoot: options.downloadRoot,
        maxBytes: options.maxBytes
      };
      const result =
        request.action === "downloadAll"
          ? await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "Downloading all artifacts as ZIP",
                cancellable: true
              },
              async (_progress, token) => {
                const abortController = new AbortController();
                const subscription = token.onCancellationRequested(() => abortController.abort());
                if (token.isCancellationRequested) {
                  abortController.abort();
                }
                try {
                  return await this.storageService.downloadAllArtifacts({
                    ...context,
                    signal: abortController.signal
                  });
                } catch (error) {
                  if (abortController.signal.aborted) {
                    return undefined;
                  }
                  throw error;
                } finally {
                  subscription.dispose();
                }
              }
            )
          : await this.storageService.downloadArtifact({
              ...context,
              relativePath: request.relativePath,
              fileName: request.fileName
            });
      if (!result) {
        return;
      }

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
