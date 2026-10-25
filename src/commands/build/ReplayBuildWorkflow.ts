import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { BuildFollowUpService } from "../../services/buildFollow/BuildFollowUpService";
import type { ReplayDraftManager, ReplayDraftSession } from "../../services/ReplayDraftManager";
import { buildReplaySessionKey } from "../../services/ReplayDraftSessionStore";
import { formatActionError } from "../CommandUtils";
import type { BuildCommandRefreshHost } from "./BuildCommandTypes";

export interface ReplayBuildTarget {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  label: string;
}

export class ReplayBuildWorkflow {
  private readonly pendingOpenSessions = new Map<string, Promise<void>>();

  constructor(
    private readonly dataService: JenkinsDataService,
    private readonly draftManager: ReplayDraftManager,
    private readonly buildFollowUp: BuildFollowUpService
  ) {}

  async openReplay(target: ReplayBuildTarget): Promise<void> {
    const existing = this.draftManager.getSessionForBuild(target.environment, target.buildUrl);
    if (existing) {
      await this.draftManager.openSession(existing);
      this.showReplayOpenedMessage(target.label);
      return;
    }

    const buildKey = buildReplaySessionKey(target.environment, target.buildUrl);
    const pending = this.pendingOpenSessions.get(buildKey);
    if (pending) {
      await pending;
      this.showReplayOpenedMessage(target.label);
      return;
    }

    const openPromise = this.openReplaySession(target);
    this.pendingOpenSessions.set(buildKey, openPromise);
    try {
      await openPromise;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to open replay drafts for ${target.label}: ${formatActionError(error)}`
      );
      return;
    } finally {
      if (this.pendingOpenSessions.get(buildKey) === openPromise) {
        this.pendingOpenSessions.delete(buildKey);
      }
    }

    this.showReplayOpenedMessage(target.label);
  }

  async runDraft(refreshHost: BuildCommandRefreshHost, uri?: vscode.Uri): Promise<void> {
    const session = await this.resolveSessionForRun(
      uri ?? vscode.window.activeTextEditor?.document.uri
    );
    if (!session) {
      return;
    }

    try {
      const payload = this.draftManager.buildSubmissionPayload(session);
      const { prepared, result } = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running replay for ${session.label}...`,
          cancellable: false
        },
        async () => {
          // Read the next build number before submitting so the new build can be told apart.
          const prepared = await this.buildFollowUp.prepare({
            kind: "cause",
            environment: session.environment,
            sourceBuildUrl: session.buildUrl,
            cause: "replay",
            mayReturnQueueItem: true
          });
          const result = await this.dataService.runReplay(
            session.environment,
            session.buildUrl,
            payload
          );
          return { prepared, result };
        }
      );

      const closeSucceeded = await this.draftManager.discardSession(session.sessionId, {
        closeTabs: true
      });
      if (!closeSucceeded) {
        console.warn(`Replay draft tabs for ${session.label} could not be closed cleanly.`);
      }

      const location = result.location ?? result.queueLocation ?? result.buildLocation;
      this.buildFollowUp.announceAndFollow(prepared, {
        location,
        requestedMessage: `Replay requested for ${session.label}`,
        plainMessage: location
          ? `Replay started for ${session.label}. Location: ${location}`
          : `Replay started for ${session.label}.`,
        refresh: () =>
          refreshHost.fullEnvironmentRefresh({ environmentId: session.environment.environmentId })
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Failed to run replay for ${session.label}: ${formatActionError(error)}`
      );
    }
  }

  private async resolveSessionForRun(
    uri: vscode.Uri | undefined
  ): Promise<ReplayDraftSession | null> {
    if (uri) {
      const direct = this.draftManager.getSessionForUri(uri);
      if (direct) {
        return direct;
      }
    }

    const visibleSessions = this.draftManager.getVisibleSessions();
    if (visibleSessions.length === 1) {
      return visibleSessions[0] ?? null;
    }

    if (visibleSessions.length > 1) {
      const selection = await vscode.window.showQuickPick(
        visibleSessions.map((session) => ({
          label: session.label,
          description: session.buildUrl,
          session
        })),
        {
          placeHolder: "Select which replay draft session to run"
        }
      );
      return selection?.session ?? null;
    }

    void vscode.window.showInformationMessage("Open a replay draft to run it.");
    return null;
  }

  private async openReplaySession(target: ReplayBuildTarget): Promise<void> {
    const existing = this.draftManager.getSessionForBuild(target.environment, target.buildUrl);
    if (existing) {
      await this.draftManager.openSession(existing);
      return;
    }

    const definition = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading replay for ${target.label}...`,
        cancellable: false
      },
      () => this.dataService.getReplayDefinition(target.environment, target.buildUrl)
    );

    const session =
      this.draftManager.getSessionForBuild(target.environment, target.buildUrl) ??
      this.draftManager.createSession(
        target.environment,
        target.buildUrl,
        target.label,
        definition
      );
    await this.draftManager.openSession(session);
  }

  private showReplayOpenedMessage(label: string): void {
    void vscode.window.showInformationMessage(`Opened replay drafts for ${label}.`);
  }
}
