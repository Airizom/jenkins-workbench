import * as vscode from "vscode";
import type { ArtifactActionHandler } from "../../ui/ArtifactActionHandler";
import type { ArtifactTreeItem } from "../../tree/TreeItems";

export async function previewArtifact(
  artifactActionHandler: ArtifactActionHandler,
  item?: ArtifactTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select an artifact to preview.");
    return;
  }

  await artifactActionHandler.handle({
    action: "preview",
    environment: item.environment,
    buildUrl: item.buildUrl,
    buildNumber: item.buildNumber,
    relativePath: item.relativePath,
    fileName: item.fileName,
    jobNameHint: item.jobNameHint
  });
}

export async function downloadArtifact(
  artifactActionHandler: ArtifactActionHandler,
  item?: ArtifactTreeItem
): Promise<void> {
  if (!item) {
    void vscode.window.showInformationMessage("Select an artifact to download.");
    return;
  }

  await artifactActionHandler.handle({
    action: "download",
    environment: item.environment,
    buildUrl: item.buildUrl,
    buildNumber: item.buildNumber,
    relativePath: item.relativePath,
    fileName: item.fileName,
    jobNameHint: item.jobNameHint
  });
}
