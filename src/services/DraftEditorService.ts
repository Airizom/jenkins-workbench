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

  async openDocuments(uris: vscode.Uri[], options?: { focusUri?: vscode.Uri }): Promise<void> {
    if (uris.length === 0) {
      return;
    }

    const orderedUris = orderUris(uris, options?.focusUri);
    const focusDocument = await vscode.workspace.openTextDocument(orderedUris[0]);
    await vscode.window.showTextDocument(focusDocument, {
      preview: false,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.Active
    });

    for (const uri of orderedUris.slice(1)) {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: true,
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
