import * as fs from "node:fs";
import * as vscode from "vscode";
import type { ArtifactFilesystem } from "./ArtifactStorageService";

// File-backed filesystem adapter for artifact downloads (requires file scheme workspaces).
export function createFileArtifactFilesystem(): ArtifactFilesystem {
  return {
    createDirectory: (directoryPath: string) =>
      vscode.workspace.fs.createDirectory(vscode.Uri.file(directoryPath)),
    createWriteStream: (filePath: string) => fs.createWriteStream(filePath),
    delete: (targetPath: string) => vscode.workspace.fs.delete(vscode.Uri.file(targetPath))
  };
}
