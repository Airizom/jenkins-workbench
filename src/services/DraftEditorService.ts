import * as vscode from "vscode";

export class DraftEditorService {
  getVisibleItems<T>(resolve: (uri: vscode.Uri) => T | undefined, keyOf: (item: T) => string): T[] {
    const ordered = new Map<string, T>();
    for (const editor of vscode.window.visibleTextEditors) {
      const item = resolve(editor.document.uri);
      if (item) {
        ordered.set(keyOf(item), item);
      }
    }
    return Array.from(ordered.values());
  }

  getVisibleUris(predicate: (uri: vscode.Uri) => boolean): vscode.Uri[] {
    return this.getVisibleItems(
      (uri) => (predicate(uri) ? uri : undefined),
      (uri) => uri.toString()
    );
  }

  /**
   * Runs `onClosed` when a document matching `isDraft` closes and stays closed.
   * VS Code also fires `onDidCloseTextDocument` when a document's language
   * changes, then reopens it right away; that is not the user closing the draft.
   * Disposing the result stops listening, then cancels pending close callbacks.
   */
  onDraftClosed(
    isDraft: (document: vscode.TextDocument) => boolean,
    onClosed: (uri: vscode.Uri) => void
  ): vscode.Disposable {
    const pendingCloses = new Set<NodeJS.Timeout>();
    const subscription = vscode.workspace.onDidCloseTextDocument((document) => {
      if (!isDraft(document)) {
        return;
      }
      const key = document.uri.toString();
      const timer = setTimeout(() => {
        pendingCloses.delete(timer);
        if (vscode.workspace.textDocuments.some((open) => open.uri.toString() === key)) {
          return;
        }
        onClosed(document.uri);
      }, 0);
      pendingCloses.add(timer);
    });
    return {
      dispose: () => {
        subscription.dispose();
        for (const timer of pendingCloses) {
          clearTimeout(timer);
        }
        pendingCloses.clear();
      }
    };
  }

  async openDocuments(uris: vscode.Uri[], options?: { focusUri?: vscode.Uri }): Promise<void> {
    if (uris.length === 0) {
      return;
    }

    const orderedUris = orderUris(uris, options?.focusUri);
    for (const [index, uri] of orderedUris.entries()) {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: index > 0,
        viewColumn: vscode.ViewColumn.Active
      });
    }
  }

  async closeUris(uris: vscode.Uri[]): Promise<boolean> {
    const uriStrings = new Set(uris.map((uri) => uri.toString()));
    const tabsToClose: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const tabUri = getTabUri(tab);
        if (!tabUri || !uriStrings.has(tabUri.toString())) {
          continue;
        }
        tabsToClose.push(tab);
      }
    }

    if (tabsToClose.length === 0) {
      return true;
    }

    return vscode.window.tabGroups.close(tabsToClose);
  }
}

function orderUris(uris: vscode.Uri[], focusUri?: vscode.Uri): vscode.Uri[] {
  const unique = new Map<string, vscode.Uri>();
  for (const uri of uris) {
    unique.set(uri.toString(), uri);
  }

  const focus = focusUri ? unique.get(focusUri.toString()) : undefined;
  const ordered = Array.from(unique.values());
  if (!focus) {
    return ordered;
  }

  return [focus, ...ordered.filter((uri) => uri.toString() !== focus.toString())];
}

function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }
  return undefined;
}
