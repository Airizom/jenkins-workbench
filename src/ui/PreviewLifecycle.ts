import * as vscode from "vscode";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";

export async function openTextPreview(
  previewProvider: ArtifactPreviewProvider,
  uri: vscode.Uri,
  options?: { languageId?: string }
): Promise<vscode.TextEditor> {
  previewProvider.markInUse(uri);
  let releaseOnClose: vscode.Disposable | undefined;

  try {
    const editor = await vscode.window.showTextDocument(uri, { preview: true });
    if (options?.languageId && editor.document.languageId !== options.languageId) {
      await vscode.languages.setTextDocumentLanguage(editor.document, options.languageId);
    }
    releaseOnClose = vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.toString() !== uri.toString()) {
        return;
      }
      previewProvider.release(uri);
      releaseOnClose?.dispose();
    });
    return editor;
  } catch (error) {
    releaseOnClose?.dispose();
    previewProvider.release(uri);
    throw error;
  }
}
