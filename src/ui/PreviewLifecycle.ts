import * as vscode from "vscode";
import type { ArtifactPreviewProvider } from "./ArtifactPreviewProvider";

export async function openResourcePreview(
  previewProvider: ArtifactPreviewProvider,
  uri: vscode.Uri
): Promise<void> {
  await withPreviewLease(
    previewProvider,
    uri,
    (release) => onPreviewTabsClosed(uri, release),
    async (release) => {
      await vscode.commands.executeCommand("vscode.open", uri, { preview: true });
      if (!isUriOpenInTabs(uri)) {
        release();
      }
    }
  );
}

export async function openTextPreview(
  previewProvider: ArtifactPreviewProvider,
  uri: vscode.Uri,
  options?: { languageId?: string }
): Promise<vscode.TextEditor> {
  return withPreviewLease(
    previewProvider,
    uri,
    (release) => onPreviewTabsClosed(uri, release),
    async (release) => {
      const editor = await vscode.window.showTextDocument(uri, { preview: true });
      if (options?.languageId && editor.document.languageId !== options.languageId) {
        await vscode.languages.setTextDocumentLanguage(editor.document, options.languageId);
      }
      if (!isUriOpenInTabs(uri)) {
        release();
      }
      return editor;
    }
  );
}

async function withPreviewLease<T>(
  previewProvider: ArtifactPreviewProvider,
  uri: vscode.Uri,
  onClose: (release: () => void) => vscode.Disposable,
  open: (release: () => void) => Promise<T>
): Promise<T> {
  previewProvider.markInUse(uri);
  let released = false;
  const releaseOnClose = onClose(release);

  function release(): void {
    if (released) {
      return;
    }
    released = true;
    releaseOnClose.dispose();
    previewProvider.release(uri);
  }

  try {
    return await open(release);
  } catch (error) {
    release();
    throw error;
  }
}

function onPreviewTabsClosed(uri: vscode.Uri, release: () => void): vscode.Disposable {
  // Register before opening; document close events also fire on language changes.
  return vscode.window.tabGroups.onDidChangeTabs((event) => {
    if (event.closed.some((tab) => tabReferencesUri(tab, uri)) && !isUriOpenInTabs(uri)) {
      release();
    }
  });
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
