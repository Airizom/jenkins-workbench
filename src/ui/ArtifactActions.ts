import * as path from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type {
  ArtifactActionService,
  ArtifactDownloadActionRequest
} from "../services/ArtifactActionService";
import type { ArtifactActionOptionsProvider } from "./ArtifactActionHandler";
import { ArtifactStorageError } from "../services/ArtifactStorageService";

const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp"
]);

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
  request: ArtifactActionRequest,
  optionsProvider: ArtifactActionOptionsProvider
): Promise<void> {
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
  const label = request.fileName || path.basename(request.relativePath) || request.relativePath;

  try {
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

    const targetUri = vscode.Uri.file(result.targetPath);
    if (request.action === "preview") {
      await openArtifactPreview(targetUri, result.headers, result.safeRelativePath);
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

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function isImageContentType(contentType?: string): boolean {
  if (!contentType) {
    return false;
  }
  const normalized = contentType.split(";")[0].trim().toLowerCase();
  return normalized.startsWith("image/");
}

async function openArtifactPreview(
  uri: vscode.Uri,
  headers: IncomingHttpHeaders,
  relativePath: string
): Promise<void> {
  const contentType = getHeaderValue(headers, "content-type");
  const extension = path.extname(relativePath).toLowerCase();
  const isImage = isImageContentType(contentType) || IMAGE_EXTENSIONS.has(extension);

  if (isImage) {
    await vscode.commands.executeCommand("vscode.open", uri);
    return;
  }

  await vscode.window.showTextDocument(uri, { preview: true });
}

function formatArtifactError(error: unknown): string {
  if (error instanceof ArtifactStorageError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error.";
}
