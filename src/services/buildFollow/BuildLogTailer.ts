import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsConsoleText, JenkinsProgressiveConsoleText } from "../../jenkins/types";
import type { ArtifactPreviewProvider } from "../../ui/ArtifactPreviewProvider";
import { openTextPreview } from "../../ui/PreviewLifecycle";
import { TextConsoleStream, type TextConsoleStreamDataService } from "../console/TextConsoleStream";
import type { FollowedBuild } from "./BuildFollowTypes";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_ERRORS = 5;

export type BuildLogTailerDataService = TextConsoleStreamDataService &
  Pick<JenkinsDataService, "getBuildDetails">;

export interface BuildLogTailerOptions {
  pollIntervalMs?: number;
}

interface TailSession {
  readonly build: FollowedBuild;
  readonly stream: TextConsoleStream;
  /** Settles, never rejects, once the initial open finished or failed. */
  readonly ready: Promise<void>;
  uri?: vscode.Uri;
  text: string;
  changed: boolean;
  stopped: boolean;
  /** Set once the build is confirmed finished after a snapshot; the next fetch is the last. */
  finalFetch: boolean;
  consecutiveErrors: number;
  timer?: NodeJS.Timeout;
}

/**
 * Shows a build's console in a read-only preview tab and appends new output until the
 * build finishes or the tab closes. One session per build URL.
 */
export class BuildLogTailer implements vscode.Disposable {
  private readonly sessions = new Map<string, TailSession>();
  private readonly pollIntervalMs: number;
  private disposed = false;

  constructor(
    private readonly dataService: BuildLogTailerDataService,
    private readonly previewProvider: ArtifactPreviewProvider,
    private readonly maxChars: number,
    options: BuildLogTailerOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async open(build: FollowedBuild): Promise<void> {
    if (this.disposed) {
      return;
    }
    const existing = this.sessions.get(build.buildUrl);
    if (existing) {
      await existing.ready;
      if (this.sessions.get(build.buildUrl) === existing && existing.uri) {
        // The session's lease stays held while any tab shows the log, so re-showing it needs no new lease.
        await vscode.window.showTextDocument(existing.uri, { preview: false });
        return;
      }
      // The session ended while we waited; start a fresh one.
      return this.open(build);
    }

    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const session = this.createSession(build, ready);
    this.sessions.set(build.buildUrl, session);
    try {
      const tail = await this.dataService.getConsoleTextTail(
        build.environment,
        build.buildUrl,
        this.maxChars
      );
      if (session.stopped) {
        return;
      }
      session.stream.seedFromTail(tail);
      session.text = tail.text;
      const uri = this.previewProvider.registerArtifact(
        Buffer.from(tail.text, "utf8"),
        `build-${build.buildNumber}.log`
      );
      session.uri = uri;
      // A regular tab: a reusable preview tab would be replaced by the next preview and stop the tail.
      await openTextPreview(this.previewProvider, uri, {
        preview: false,
        onReleased: () => this.endSession(session)
      });
      if (tail.truncated) {
        void vscode.window.showInformationMessage(
          `Showing last ${this.maxChars.toLocaleString()} characters of console output for ${build.label}.`
        );
      }
      this.schedulePoll(session);
    } catch (error) {
      this.endSession(session);
      throw error;
    } finally {
      markReady();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions.values()) {
      this.stopPolling(session);
    }
    this.sessions.clear();
  }

  private createSession(build: FollowedBuild, ready: Promise<void>): TailSession {
    const session: TailSession = {
      build,
      ready,
      text: "",
      changed: false,
      stopped: false,
      finalFetch: false,
      consecutiveErrors: 0,
      stream: new TextConsoleStream({
        dataService: this.dataService,
        environment: build.environment,
        buildUrl: build.buildUrl,
        maxConsoleChars: this.maxChars,
        callbacks: {
          onConsoleAppend: (text) => {
            session.text += text;
            session.changed = true;
          },
          onConsoleSet: ({ text }) => {
            session.text = text;
            session.changed = true;
          }
        }
      })
    };
    return session;
  }

  private schedulePoll(session: TailSession, delayMs = this.pollIntervalMs): void {
    if (session.stopped) {
      return;
    }
    session.timer = setTimeout(() => {
      session.timer = undefined;
      void this.poll(session);
    }, delayMs);
  }

  private async poll(session: TailSession): Promise<void> {
    let result: JenkinsProgressiveConsoleText | JenkinsConsoleText;
    try {
      result = await session.stream.fetchNext();
    } catch {
      if (session.stopped) {
        return;
      }
      session.stream.handleError();
      this.recordError(session);
      return;
    }
    if (session.stopped) {
      return;
    }
    session.changed = false;
    session.stream.applyResult(result);
    if (session.changed && !this.publish(session)) {
      return;
    }
    if (session.finalFetch) {
      this.stopPolling(session);
      return;
    }

    const progressive = isProgressive(result);
    if (isProgressive(result) && result.moreData) {
      session.consecutiveErrors = 0;
      this.schedulePoll(session);
      return;
    }
    let finished: boolean;
    try {
      finished = await this.isBuildFinished(session.build);
    } catch {
      if (!session.stopped) {
        this.recordError(session);
      }
      return;
    }
    if (session.stopped) {
      return;
    }
    session.consecutiveErrors = 0;
    if (!finished) {
      this.schedulePoll(session);
      return;
    }
    if (progressive) {
      // moreData=false already delivered the rest of the log.
      this.stopPolling(session);
      return;
    }
    // A snapshot may predate the build's last output, so read once more.
    session.finalFetch = true;
    this.schedulePoll(session, 0);
  }

  private async isBuildFinished(build: FollowedBuild): Promise<boolean> {
    const details = await this.dataService.getBuildDetails(build.environment, build.buildUrl, {
      statusOnly: true,
      bypassCache: true
    });
    return details.building === false;
  }

  private publish(session: TailSession): boolean {
    if (!session.uri) {
      return false;
    }
    if (this.previewProvider.updateArtifact(session.uri, Buffer.from(session.text, "utf8"))) {
      return true;
    }
    this.stopPolling(session);
    void vscode.window.showWarningMessage(
      `Stopped updating the console log for ${session.build.label}: the preview cache is full.`
    );
    return false;
  }

  private recordError(session: TailSession): void {
    session.consecutiveErrors += 1;
    if (session.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      // Keep the existing document readable, but let the next open fetch a fresh tail.
      this.endSession(session);
      return;
    }
    this.schedulePoll(session);
  }

  private stopPolling(session: TailSession): void {
    session.stopped = true;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = undefined;
    }
  }

  private endSession(session: TailSession): void {
    this.stopPolling(session);
    if (this.sessions.get(session.build.buildUrl) === session) {
      this.sessions.delete(session.build.buildUrl);
    }
  }
}

function isProgressive(
  value: JenkinsProgressiveConsoleText | JenkinsConsoleText
): value is JenkinsProgressiveConsoleText {
  return "textSize" in value && "moreData" in value;
}
