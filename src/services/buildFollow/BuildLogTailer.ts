import * as vscode from "vscode";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleText
} from "../../jenkins/types";
import { normalizeJenkinsUrlForComparison } from "../../jenkins/urls";
import {
  buildResultsCompatible,
  isBuildQueueId,
  matchesBuildActionRun
} from "../../shared/build/BuildCompletionEvidence";
import type { ArtifactPreviewProvider } from "../../ui/ArtifactPreviewProvider";
import { openTextPreview } from "../../ui/PreviewLifecycle";
import { TextConsoleStream, type TextConsoleStreamDataService } from "../console/TextConsoleStream";
import type { FollowedBuildActionTarget } from "./BuildFollowTypes";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_CONSECUTIVE_ERRORS = 5;

export type BuildLogTailerDataService = TextConsoleStreamDataService &
  Pick<JenkinsDataService, "getBuildDetails">;

export interface BuildLogTailerOptions {
  pollIntervalMs?: number;
}

interface TailSession {
  readonly build: FollowedBuildActionTarget;
  readonly key: string;
  readonly openOrder: number;
  lastVerifiedOrder?: number;
  superseded?: boolean;
  requireQueueId: boolean;
  /** A competing open verified another Run at this endpoint. */
  verifyLogReads?: boolean;
  completion?: { result?: string };
  readonly stream: TextConsoleStream;
  /** Concurrent opens wait for the same initial fetch and tab. */
  ready?: Promise<void>;
  queueId?: number;
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
 * build finishes or the tab closes. Separate runs retain separate preview documents.
 */
export class BuildLogTailer implements vscode.Disposable {
  private readonly sessions = new Map<string, TailSession>();
  private readonly pending = new Set<TailSession>();
  private sequence = 0;
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

  async open(build: FollowedBuildActionTarget): Promise<void> {
    if (this.disposed) {
      return;
    }
    const { environment } = build;
    const key = JSON.stringify([
      environment.scope,
      environment.environmentId,
      normalizeJenkinsUrlForComparison(environment.url),
      normalizeJenkinsUrlForComparison(build.buildUrl, environment.url),
      build.buildNumber
    ]);
    const incumbent = this.sessions.get(key);
    const existing =
      incumbent && canReuseSession(incumbent, build)
        ? incumbent
        : Array.from(this.pending).find(
            (candidate) => candidate.key === key && canReuseSession(candidate, build)
          );
    if (existing) {
      existing.completion ??= build.completion;
      await existing.ready;
      if (this.sessions.get(key) === existing && existing.uri)
        await vscode.window.showTextDocument(existing.uri, { preview: false });
      return;
    }

    const session = this.createSession(key, build);
    this.pending.add(session);
    session.ready = this.openSession(session);
    return session.ready;
  }

  private async openSession(session: TailSession): Promise<void> {
    const { build } = session;
    try {
      if (!isBuildQueueId(build.queueId) && !build.completion) {
        // Capture any Run ID before fetching an anonymous preview. Older Jenkins instances
        // can still serve console text when this optional status read is unavailable.
        const status = await this.readStatus(session).catch(() => null);
        if (!this.confirmPreviewStatus(session, status)) return;
      }
      const tail = await this.dataService.getConsoleTextTail(
        build.environment,
        build.buildUrl,
        this.maxChars
      );
      if (session.stopped) {
        return;
      }
      if (
        this.shouldVerifyPreview(session) &&
        !this.confirmPreviewStatus(session, await this.readStatus(session))
      )
        return;
      await this.openPreviewTab(session, tail);
      if (session.stopped) return;
      if (!this.installPreview(session)) return;
      if (tail.truncated) {
        void vscode.window.showInformationMessage(
          `Showing last ${this.maxChars.toLocaleString()} characters of console output for ${build.label}.`
        );
      }
      this.schedulePoll(session);
    } catch (error) {
      if (this.disposed || session.superseded) return;
      this.endSession(session);
      throw error;
    } finally {
      this.pending.delete(session);
    }
  }

  private shouldVerifyPreview(session: TailSession): boolean {
    return (
      isBuildQueueId(session.queueId) ||
      Boolean(session.completion) ||
      this.sessions.has(session.key)
    );
  }

  private confirmPreviewStatus(session: TailSession, status: unknown): boolean {
    if (session.stopped) return false;
    // A null preliminary status denotes an unavailable optional read.
    if (status === undefined)
      throw new Error(`Jenkins could not confirm ${session.build.label} at its numbered URL.`);
    return true;
  }

  private openPreviewTab(
    session: TailSession,
    tail: JenkinsConsoleTextTail
  ): Promise<vscode.TextEditor> {
    const previous = this.sessions.get(session.key);
    if (previous && session.requireQueueId && previous.queueId !== session.queueId)
      previous.verifyLogReads = true;
    session.stream.seedFromTail(tail);
    session.text = tail.text;
    const uri = this.previewProvider.registerArtifact(
      Buffer.from(tail.text, "utf8"),
      `build-${session.build.buildNumber}.log`
    );
    session.uri = uri;
    // A regular tab: a reusable preview tab would be replaced by the next preview and stop the tail.
    return openTextPreview(this.previewProvider, uri, {
      preview: false,
      onReleased: () => this.endSession(session)
    });
  }

  private installPreview(session: TailSession): boolean {
    const incumbent = this.sessions.get(session.key);
    const competitors = Array.from(this.pending).filter(
      (other) => other !== session && other.key === session.key
    );
    if (
      (incumbent && hasNewerPreview(incumbent, session)) ||
      competitors.some((other) => other.uri && hasNewerPreview(other, session))
    ) {
      this.endSession(session);
      return false;
    }
    if (incumbent) this.endSession(incumbent);
    this.sessions.set(session.key, session);
    for (const other of competitors) {
      // An open still fetching its tail can verify a newer Run. Let it finish,
      // but suppress a stale failure once a later open has already succeeded.
      if (other.uri || other.openOrder < session.openOrder) other.superseded = true;
      if (other.uri) this.endSession(other);
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions.values()) {
      this.stopPolling(session);
    }
    for (const session of this.pending) this.stopPolling(session);
    this.pending.clear();
    this.sessions.clear();
  }

  private createSession(key: string, build: FollowedBuildActionTarget): TailSession {
    const session: TailSession = {
      key,
      openOrder: ++this.sequence,
      build,
      requireQueueId: build.requireQueueId === true,
      completion: build.completion,
      queueId: isBuildQueueId(build.queueId) ? build.queueId : undefined,
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
    const more = isProgressive(result) && result.moreData;
    let finished = false;
    if (isBuildQueueId(session.queueId) || session.completion || session.verifyLogReads || !more) {
      const verified = await this.verifyLogRead(session);
      if (verified === undefined || session.stopped) return;
      finished = verified;
    }
    this.applyLogRead(session, result, more, finished);
  }

  private applyLogRead(
    session: TailSession,
    result: JenkinsProgressiveConsoleText | JenkinsConsoleText,
    more: boolean,
    finished: boolean
  ): void {
    session.changed = false;
    session.stream.applyResult(result);
    if (session.changed && !this.publish(session)) return;
    if (session.finalFetch || (finished && isProgressive(result) && !more)) {
      this.finishSession(session);
      return;
    }
    session.consecutiveErrors = 0;
    if (!finished || more) {
      this.schedulePoll(session);
      return;
    }
    // A snapshot may predate the build's last output, so read once more.
    session.finalFetch = true;
    this.schedulePoll(session, 0);
  }

  private async verifyLogRead(session: TailSession): Promise<boolean | undefined> {
    // Check identity before publishing bytes. The endpoint may now serve a different run.
    try {
      const status = await this.readStatus(session);
      if (session.stopped) return undefined;
      if (!status) {
        this.endSession(session);
        return undefined;
      }
      return status.building === false;
    } catch {
      if (!session.stopped) this.recordError(session);
      return undefined;
    }
  }

  private async readStatus(session: TailSession) {
    const { build } = session;
    const requestOrder = ++this.sequence;
    const status = await this.dataService.getBuildDetails(build.environment, build.buildUrl, {
      statusOnly: true,
      bypassCache: true
    });
    if (session.stopped) return undefined;
    if (this.conflictsWithPreview(session, status.queueId, requestOrder)) return undefined;
    if (
      (session.verifyLogReads && !isBuildQueueId(status.queueId)) ||
      !matchesBuildActionRun(
        {
          buildNumber: build.buildNumber,
          queueId: session.queueId,
          requireQueueId: session.requireQueueId,
          completion: session.completion
        },
        status,
        !session.uri && !build.completion
      )
    )
      return undefined;
    session.lastVerifiedOrder = requestOrder;
    if (isBuildQueueId(status.queueId)) {
      session.queueId = status.queueId;
      session.requireQueueId = true;
    }
    if (status.building === false)
      session.completion = { result: status.result ?? session.completion?.result };
    return status;
  }

  private conflictsWithPreview(
    session: TailSession,
    queueId: number | undefined,
    requestOrder: number
  ): boolean {
    const incumbent = this.sessions.get(session.key);
    if (!incumbent || incumbent === session) return false;
    const hasNamedRun = isBuildQueueId(incumbent.queueId) || isBuildQueueId(session.queueId);
    return (
      (hasNamedRun && !isBuildQueueId(queueId)) ||
      (incumbent.queueId !== queueId &&
        this.hasNewerConflictingStatus(incumbent, session, requestOrder))
    );
  }

  private hasNewerConflictingStatus(
    incumbent: TailSession,
    candidate: TailSession,
    requestOrder?: number
  ): boolean {
    return (
      incumbent.requireQueueId &&
      incumbent.queueId !== candidate.queueId &&
      (incumbent.lastVerifiedOrder ?? 0) > (requestOrder ?? 0)
    );
  }

  private finishSession(session: TailSession): void {
    // A terminal tab can be reused only when its bytes belong to an identified run.
    if (session.requireQueueId && isBuildQueueId(session.queueId)) this.stopPolling(session);
    else this.endSession(session);
  }

  private publish(session: TailSession): boolean {
    if (!session.uri) {
      return false;
    }
    if (this.previewProvider.updateArtifact(session.uri, Buffer.from(session.text, "utf8"))) {
      return true;
    }
    this.endSession(session);
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
    this.pending.delete(session);
    if (this.sessions.get(session.key) === session) {
      this.sessions.delete(session.key);
    }
  }
}

function hasNewerPreview(left: TailSession, right: TailSession): boolean {
  const leftIdentified = left.requireQueueId && isBuildQueueId(left.queueId);
  const rightIdentified = right.requireQueueId && isBuildQueueId(right.queueId);
  if (leftIdentified !== rightIdentified) return leftIdentified;
  return (left.lastVerifiedOrder ?? left.openOrder) > (right.lastVerifiedOrder ?? right.openOrder);
}

function canReuseSession(session: TailSession, build: FollowedBuildActionTarget): boolean {
  if (!isBuildQueueId(build.queueId))
    return !session.uri && !session.stopped && build === session.build;
  return (
    build.queueId === session.queueId &&
    (session.requireQueueId ||
      (!build.requireQueueId && !build.completion && !session.completion)) &&
    buildResultsCompatible(build.completion?.result, session.completion?.result)
  );
}

function isProgressive(
  value: JenkinsProgressiveConsoleText | JenkinsConsoleText
): value is JenkinsProgressiveConsoleText {
  return "textSize" in value && "moreData" in value;
}
