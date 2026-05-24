import * as vscode from "vscode";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";

export async function openResourcePreview(
  previewProvider: ArtifactPreviewProvider,
  uri: vscode.Uri
): Promise<void> {
  previewProvider.markInUse(uri);
  let released = false;
  const releaseOnClose = vscode.window.tabGroups.onDidChangeTabs((event) => {
    if (!event.closed.some((tab) => tabReferencesUri(tab, uri))) {
      return;
    }
    release();
  });

  function release(): void {
    if (released) {
      return;
    }
    released = true;
    releaseOnClose.dispose();
    previewProvider.release(uri);
  }

  try {
    await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
    if (!isUriOpenInTabs(uri)) {
      release();
    }
  } catch (error) {
    release();
    throw error;
  }
}

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

function isUriOpenInTabs(uri: vscode.Uri): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tabReferencesUri(tab, uri))
  );
}

function tabReferencesUri(tab: vscode.Tab, uri: vscode.Uri): boolean {
  return getTabInputUris(tab.input).some((inputUri) => inputUri.toString() === uri.toString());
}

function getTabInputUris(input: unknown): vscode.Uri[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const candidate = input as {
    uri?: vscode.Uri;
    original?: vscode.Uri;
    modified?: vscode.Uri;
  };
  return [candidate.uri, candidate.original, candidate.modified].filter(isUri);
}

function isUri(value: vscode.Uri | undefined): value is vscode.Uri {
  return value !== undefined && typeof value.toString === "function";
}
