import * as vscode from "vscode";
import { DraftEditorService } from "./DraftEditorService";
import type { ReplayDraftSession, ReplayDraftSessionStore } from "./ReplayDraftSessionStore";

export class ReplayDraftEditorCoordinator implements vscode.Disposable {
  private readonly closingSessions = new Set<string>();
  private readonly promptingSessions = new Set<string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly store: ReplayDraftSessionStore,
    private readonly editorService: DraftEditorService = new DraftEditorService()
  ) {
    this.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => this.syncDraftContent(document)),
      vscode.workspace.onDidChangeTextDocument((event) => this.syncDraftContent(event.document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (!this.store.hasDraft(document.uri)) {
          return;
        }
        void this.handleDraftClosed(document.uri).catch((error) => {
          console.warn("Failed to process replay draft close.", error);
        });
      })
    );
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.subscriptions.length = 0;
    this.closingSessions.clear();
    this.promptingSessions.clear();
  }

  getVisibleSessions(): ReplayDraftSession[] {
    return this.editorService.getVisibleItems(
      (uri) => this.store.getSessionForUri(uri),
      (session) => session.sessionId
    );
  }

  async openSession(session: ReplayDraftSession, focusUri?: vscode.Uri): Promise<void> {
    const focusScript = resolveFocusScript(session, focusUri);
    await this.editorService.openDocuments(
      session.scripts.map((script) => script.uri),
      { focusUri: focusScript.uri }
    );
  }

  async discardSession(sessionId: string, options?: { closeTabs?: boolean }): Promise<boolean> {
    const resolvedSession = this.store.getSession(sessionId);
    if (options?.closeTabs && resolvedSession) {
      this.closingSessions.add(sessionId);
      try {
        const closed = await this.closeSessionTabs(resolvedSession);
        if (!closed) {
          return false;
        }
      } finally {
        this.closingSessions.delete(sessionId);
      }
    }

    this.store.discardSession(sessionId);
    this.promptingSessions.delete(sessionId);
    return true;
  }

  private async handleDraftClosed(uri: vscode.Uri): Promise<void> {
    const session = this.store.getSessionForUri(uri);
    if (
      !session ||
      this.closingSessions.has(session.sessionId) ||
      this.promptingSessions.has(session.sessionId)
    ) {
      return;
    }

    this.promptingSessions.add(session.sessionId);
    try {
      const discard = await vscode.window.showWarningMessage(
        `Closing any replay draft will discard the entire replay session for ${session.label}.`,
        { modal: true },
        "Discard Replay Session",
        "Keep Replay Session"
      );

      if (discard === "Discard Replay Session") {
        await this.discardSession(session.sessionId, { closeTabs: true });
        return;
      }

      this.store.restoreFilesystemContents(session);
      await this.openSession(session, uri);
    } finally {
      this.promptingSessions.delete(session.sessionId);
    }
  }

  private async closeSessionTabs(session: ReplayDraftSession): Promise<boolean> {
    for (const document of vscode.workspace.textDocuments) {
      if (!this.store.hasDraft(document.uri) || !document.isDirty) {
        continue;
      }
      if (this.store.getSessionForUri(document.uri)?.sessionId !== session.sessionId) {
        continue;
      }
      await document.save();
    }

    return this.editorService.closeUris(session.scripts.map((script) => script.uri));
  }

  private syncDraftContent(document: vscode.TextDocument): void {
    this.store.updateDraftContent(document.uri, document.getText());
  }
}

function resolveFocusScript(session: ReplayDraftSession, focusUri?: vscode.Uri) {
  if (focusUri) {
    const matched = session.scripts.find((script) => script.uri.toString() === focusUri.toString());
    if (matched) {
      return matched;
    }
  }

  const fallback = session.scripts.find((script) => script.isMainScript) ?? session.scripts[0];
  if (!fallback) {
    throw new Error("Replay session does not contain any draft documents.");
  }
  return fallback;
}
