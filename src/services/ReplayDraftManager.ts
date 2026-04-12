import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsReplayDefinition, JenkinsReplaySubmissionPayload } from "../jenkins/types";
import { ReplayDraftEditorCoordinator } from "./ReplayDraftEditorCoordinator";
import type { ReplayDraftFilesystem } from "./ReplayDraftFilesystem";
import { type ReplayDraftSession, ReplayDraftSessionStore } from "./ReplayDraftSessionStore";

export type { ReplayDraftScript, ReplayDraftSession } from "./ReplayDraftSessionStore";

export class ReplayDraftManager implements vscode.Disposable {
  private readonly store: ReplayDraftSessionStore;
  private readonly editorCoordinator: ReplayDraftEditorCoordinator;

  constructor(filesystem: ReplayDraftFilesystem) {
    this.store = new ReplayDraftSessionStore(filesystem);
    this.editorCoordinator = new ReplayDraftEditorCoordinator(this.store);
  }

  dispose(): void {
    this.editorCoordinator.dispose();
    this.store.dispose();
  }

  hasDraft(uri: vscode.Uri): boolean {
    return this.store.hasDraft(uri);
  }

  getSessionForUri(uri: vscode.Uri): ReplayDraftSession | undefined {
    return this.store.getSessionForUri(uri);
  }

  getSessionForBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): ReplayDraftSession | undefined {
    return this.store.getSessionForBuild(environment, buildUrl);
  }

  getVisibleSessions(): ReplayDraftSession[] {
    return this.editorCoordinator.getVisibleSessions();
  }

  createSession(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    label: string,
    definition: JenkinsReplayDefinition
  ): ReplayDraftSession {
    return this.store.createSession(environment, buildUrl, label, definition);
  }

  async openSession(session: ReplayDraftSession, focusUri?: vscode.Uri): Promise<void> {
    await this.editorCoordinator.openSession(session, focusUri);
  }

  buildSubmissionPayload(session: ReplayDraftSession): JenkinsReplaySubmissionPayload {
    return this.store.buildSubmissionPayload(session);
  }

  async discardSession(sessionId: string, options?: { closeTabs?: boolean }): Promise<boolean> {
    return this.editorCoordinator.discardSession(sessionId, options);
  }
}
