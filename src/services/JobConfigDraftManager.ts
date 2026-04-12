import * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { DraftEditorService } from "./DraftEditorService";
import { JOB_CONFIG_DRAFT_SCHEME } from "./JobConfigDraftFilesystem";
import type { JobConfigDraftFilesystem } from "./JobConfigDraftFilesystem";

export type JobConfigDraft = {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
  originalUri: vscode.Uri;
  originalXml: string;
};

export class JobConfigDraftManager implements vscode.Disposable {
  private readonly drafts = new Map<string, JobConfigDraft>();
  private readonly manualSaveQueue = new Set<string>();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly submitEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidRequestSubmit = this.submitEmitter.event;

  constructor(
    private readonly filesystem: JobConfigDraftFilesystem,
    private readonly editorService: DraftEditorService = new DraftEditorService()
  ) {
    this.subscriptions.push(
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (!this.isDraftDocument(event.document)) {
          return;
        }
        if (event.reason === vscode.TextDocumentSaveReason.Manual) {
          this.manualSaveQueue.add(event.document.uri.toString());
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!this.isDraftDocument(document)) {
          return;
        }
        const key = document.uri.toString();
        const shouldSubmit = this.manualSaveQueue.delete(key);
        if (shouldSubmit) {
          this.submitEmitter.fire(document.uri);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!this.isDraftDocument(document)) {
          return;
        }
        this.discardDraft(document.uri);
      }),
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

  createDraft(label: string, content: string, draft: JobConfigDraft): vscode.Uri {
    const uri = this.filesystem.createDraft(label, content);
    this.drafts.set(getUriKey(uri), draft);
    return uri;
  }

  getDraft(uri: vscode.Uri): JobConfigDraft | undefined {
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

  getVisibleDrafts(): Array<{ uri: vscode.Uri; label: string }> {
    return this.editorService
      .getVisibleUris((uri) => this.hasDraft(uri))
      .map((uri) => {
        const draft = this.getDraft(uri);
        return {
          uri,
          label: draft?.label ?? "Unknown"
        };
      });
  }

  private isDraftDocument(document: vscode.TextDocument): boolean {
    return document.uri.scheme === JOB_CONFIG_DRAFT_SCHEME || this.hasDraft(document.uri);
  }
}

function getUriKey(uri: vscode.Uri): string {
  return uri.toString();
}
