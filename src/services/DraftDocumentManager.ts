import * as vscode from "vscode";
import { DraftEditorService } from "./DraftEditorService";

/** The slice of an in-memory draft filesystem that a draft manager needs. */
export interface DraftDocumentFilesystem {
  createDraft(label: string, content: string): vscode.Uri;
  hasDraft(uri: vscode.Uri): boolean;
  removeDraft(uri: vscode.Uri): void;
}

export interface VisibleDraft {
  uri: vscode.Uri;
  label: string;
}

/**
 * Tracks editable drafts that live in an in-memory filesystem scheme.
 * A manual save fires `onDidRequestSubmit`; closing the tab discards the draft.
 */
export class DraftDocumentManager<TDraft extends { label: string }> implements vscode.Disposable {
  private readonly drafts = new Map<string, TDraft>();
  private readonly manualSaveQueue = new Set<string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly submitEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidRequestSubmit = this.submitEmitter.event;

  constructor(
    private readonly filesystem: DraftDocumentFilesystem,
    private readonly scheme: string,
    private readonly editorService: DraftEditorService = new DraftEditorService()
  ) {
    this.subscriptions.push(
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (!this.isDraftDocument(event.document)) {
          return;
        }
        if (event.reason === vscode.TextDocumentSaveReason.Manual) {
          this.manualSaveQueue.add(getUriKey(event.document.uri));
        } else {
          this.manualSaveQueue.delete(getUriKey(event.document.uri));
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!this.isDraftDocument(document)) {
          return;
        }
        const key = getUriKey(document.uri);
        const shouldSubmit = this.manualSaveQueue.delete(key);
        if (shouldSubmit) {
          this.submitEmitter.fire(document.uri);
        }
      }),
      this.editorService.onDraftClosed(
        (document) => this.isDraftDocument(document),
        (uri) => this.discardDraft(uri)
      ),
      this.submitEmitter
    );
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
    this.drafts.clear();
    this.manualSaveQueue.clear();
  }

  createDraft(label: string, content: string, draft: TDraft): vscode.Uri {
    const uri = this.filesystem.createDraft(label, content);
    this.drafts.set(getUriKey(uri), draft);
    return uri;
  }

  getDraft(uri: vscode.Uri): TDraft | undefined {
    return this.drafts.get(getUriKey(uri));
  }

  hasDraft(uri: vscode.Uri): boolean {
    return this.drafts.has(getUriKey(uri));
  }

  discardDraft(uri: vscode.Uri): void {
    const key = getUriKey(uri);
    this.drafts.delete(key);
    this.manualSaveQueue.delete(key);
    if (this.filesystem.hasDraft(uri)) {
      this.filesystem.removeDraft(uri);
    }
  }

  getVisibleDrafts(): VisibleDraft[] {
    return this.editorService
      .getVisibleUris((uri) => this.hasDraft(uri))
      .map((uri) => ({ uri, label: this.getDraft(uri)?.label ?? "Unknown" }));
  }

  private isDraftDocument(document: vscode.TextDocument): boolean {
    return document.uri.scheme === this.scheme || this.hasDraft(document.uri);
  }
}

function getUriKey(uri: vscode.Uri): string {
  return uri.toString();
}
