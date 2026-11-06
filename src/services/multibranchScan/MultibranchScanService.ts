import * as vscode from "vscode";
import type { JenkinsQueueItemInfo } from "../../jenkins/data/JenkinsDataTypes";
import { JenkinsConsoleNoteFilter } from "../../jenkins/JenkinsConsoleNotes";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsIndexingLog } from "../../jenkins/JenkinsIndexingTypes";
import type { JenkinsQueueItem, ScanMultibranchResult } from "../../jenkins/types";
import { normalizeJenkinsUrlForComparison, parseQueueItemId } from "../../jenkins/urls";
import { MAX_CONSOLE_CHARS } from "../ConsoleOutputConfig";
import {
  type MultibranchScanOutcome,
  type MultibranchScanState,
  type MultibranchScanStateStore,
  type MultibranchScanTarget,
  multibranchScanKey
} from "./MultibranchScanState";

export interface MultibranchScanDataService {
  getQueueItems(environment: JenkinsEnvironmentRef): Promise<JenkinsQueueItemInfo[]>;
  getQueueItem(environment: JenkinsEnvironmentRef, queueId: number): Promise<JenkinsQueueItem>;
  scanMultibranch(
    environment: JenkinsEnvironmentRef,
    folderUrl: string
  ): Promise<ScanMultibranchResult>;
  getMultibranchScanLog(
    environment: JenkinsEnvironmentRef,
    folderUrl: string,
    options?: { maxChars?: number; signal?: AbortSignal }
  ): Promise<JenkinsIndexingLog>;
}

export interface MultibranchScanServiceOptions {
  pollIntervalMs?: number;
  evidenceTimeoutMs?: number;
  maxConsecutiveErrors?: number;
  maxConcurrency?: number;
}

interface ScanSession {
  key: string;
  state: MultibranchScanState;
  ready: Promise<MultibranchScanState>;
  abort: AbortController;
  stopped: boolean;
  requested: boolean;
  submitted: boolean;
  trackCompletion: boolean;
  confirmedNewLog: boolean;
  baseline?: JenkinsIndexingLog;
  queueId?: number;
  lastEvidenceAt: number;
  errors: number;
  timer?: NodeJS.Timeout;
}

interface Observation {
  log?: JenkinsIndexingLog;
  logError?: unknown;
  queue?: JenkinsQueueItemInfo;
  queueError?: unknown;
  cancelled?: boolean;
}

/** Follows folder computations without assuming a build-style indexing JSON API exists. */
export class MultibranchScanService implements vscode.Disposable {
  private readonly sessions = new Map<string, ScanSession>();
  private readonly completionEmitter = new vscode.EventEmitter<MultibranchScanState>();
  readonly onDidComplete = this.completionEmitter.event;
  private readonly queueRequests = new Map<
    string,
    { at: number; pending: boolean; promise: Promise<JenkinsQueueItemInfo[]> }
  >();
  private readonly waiting: Array<() => void> = [];
  private readonly environmentGenerations = new Map<string, number>();
  private activeRequests = 0;
  private nextGeneration = 0;
  private disposed = false;
  private readonly pollIntervalMs: number;
  private readonly evidenceTimeoutMs: number;
  private readonly maxConsecutiveErrors: number;
  private readonly maxConcurrency: number;

  constructor(
    private readonly dataService: MultibranchScanDataService,
    private readonly stateStore: MultibranchScanStateStore,
    options: MultibranchScanServiceOptions = {}
  ) {
    this.pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 2000);
    this.evidenceTimeoutMs = Math.max(1, options.evidenceTimeoutMs ?? 60_000);
    this.maxConsecutiveErrors = Math.max(1, options.maxConsecutiveErrors ?? 5);
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 3);
  }

  // fallow-ignore-next-line unused-class-member -- called through the log viewer’s Pick<MultibranchScanService> interface
  getState(target: MultibranchScanTarget): MultibranchScanState | undefined {
    return this.stateStore.get(target);
  }

  request(target: MultibranchScanTarget): Promise<MultibranchScanState> {
    return this.start(target, true);
  }

  attach(target: MultibranchScanTarget): Promise<MultibranchScanState> {
    return this.start(target, false);
  }

  stopEnvironment(environmentId: string, reason: string): void {
    this.environmentGenerations.set(
      environmentId,
      (this.environmentGenerations.get(environmentId) ?? 0) + 1
    );
    for (const session of this.sessions.values()) {
      if (session.state.target.environment.environmentId === environmentId) {
        this.publish(session, { phase: "unavailable", detail: reason });
        this.stop(session);
      }
    }
    this.queueRequests.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    for (const session of this.sessions.values()) {
      this.publish(session, { phase: "unavailable", detail: "Scan tracking stopped." });
      this.stop(session);
    }
    this.disposed = true;
    this.sessions.clear();
    this.queueRequests.clear();
    this.completionEmitter.dispose();
  }

  private start(target: MultibranchScanTarget, submit: boolean): Promise<MultibranchScanState> {
    if (this.disposed) {
      return Promise.reject(new Error("Scan tracking has stopped."));
    }
    const key = multibranchScanKey(target);
    const existing = this.sessions.get(key);
    if (existing && !existing.stopped) {
      const environmentGeneration =
        this.environmentGenerations.get(target.environment.environmentId) ?? 0;
      return existing.ready.then(() => {
        if (
          this.disposed ||
          environmentGeneration !==
            (this.environmentGenerations.get(target.environment.environmentId) ?? 0)
        ) {
          return existing.state;
        }
        if (submit && !existing.requested && !existing.trackCompletion) {
          // An attachment preflight is not a scan request. If it found only a
          // historical log, honor a scan command that arrived while it was loading.
          this.stop(existing);
          return this.start(target, true);
        }
        return existing.state;
      });
    }
    const state: MultibranchScanState = {
      target,
      phase: "requested",
      observedAt: Date.now(),
      generation: ++this.nextGeneration,
      logRevision: 0
    };
    const session: ScanSession = {
      key,
      state,
      ready: Promise.resolve(state),
      abort: new AbortController(),
      stopped: false,
      requested: submit,
      submitted: false,
      trackCompletion: false,
      confirmedNewLog: false,
      lastEvidenceAt: Date.now(),
      errors: 0
    };
    this.sessions.set(key, session);
    this.stateStore.set(state);
    session.ready = this.initialize(session, submit);
    return session.ready;
  }

  private async initialize(session: ScanSession, submit: boolean): Promise<MultibranchScanState> {
    const initial = await this.observe(session);
    if (!this.isCurrent(session)) {
      return session.state;
    }
    session.baseline = initial.log;
    const activeLog = isRunning(initial.log);
    if (initial.queue || activeLog || !submit) {
      session.trackCompletion = Boolean(initial.queue || activeLog);
      session.confirmedNewLog = activeLog;
      this.reconcile(session, initial, true);
      return session.state;
    }
    if (initial.log) {
      this.publish(session, {
        log: initial.log,
        detail: "Waiting for the requested scan to start."
      });
    }
    try {
      const result = await this.limit(async () => {
        if (!this.isCurrent(session)) {
          return undefined;
        }
        const target = session.state.target;
        return this.dataService.scanMultibranch(target.environment, target.folderUrl);
      });
      if (!this.isCurrent(session) || !result) {
        return session.state;
      }
      session.submitted = true;
      session.trackCompletion = true;
      session.lastEvidenceAt = Date.now();
      session.queueId = parseQueueItemId(result.queueLocation);
      this.queueRequests.delete(this.environmentKey(session.state.target.environment));
      this.publish(session, {
        phase: session.queueId ? "queued" : "requested",
        detail: session.queueId
          ? "Waiting in the Jenkins queue."
          : "Waiting for evidence of the requested scan.",
        logError: initial.logError ? errorMessage(initial.logError) : undefined
      });
      this.schedule(session);
      return session.state;
    } catch (error) {
      if (this.isCurrent(session)) {
        this.publish(session, {
          phase: "unavailable",
          detail: `Scan submission failed: ${errorMessage(error)}`
        });
        this.stop(session);
      }
      throw error;
    }
  }

  private async observe(session: ScanSession): Promise<Observation> {
    const { environment, folderUrl } = session.state.target;
    const [queue, log] = await Promise.allSettled([
      this.getQueue(environment),
      this.limit(() => {
        if (!this.isCurrent(session)) {
          throw new Error("Scan tracking stopped.");
        }
        return this.dataService.getMultibranchScanLog(environment, folderUrl, {
          maxChars: MAX_CONSOLE_CHARS,
          signal: session.abort.signal
        });
      })
    ]);
    const observation: Observation = {
      log: log.status === "fulfilled" ? log.value : undefined,
      logError: log.status === "rejected" ? log.reason : undefined,
      queueError: queue.status === "rejected" ? queue.reason : undefined
    };
    if (queue.status === "fulfilled") {
      observation.queue = queue.value.find(
        (item) =>
          item.taskUrl &&
          normalizeJenkinsUrlForComparison(item.taskUrl) ===
            normalizeJenkinsUrlForComparison(folderUrl)
      );
      if (observation.queue) {
        session.queueId = observation.queue.id;
      }
    }
    if (!observation.queue && session.queueId !== undefined && this.isCurrent(session)) {
      try {
        const item = await this.limit(() => {
          if (!this.isCurrent(session)) {
            throw new Error("Scan tracking stopped.");
          }
          return this.dataService.getQueueItem(environment, session.queueId as number);
        });
        observation.cancelled = item.cancelled === true;
      } catch {
        // Queue entries expire quickly. Disappearance proves neither completion nor success.
      }
    }
    return observation;
  }

  private reconcile(session: ScanSession, observation: Observation, initial = false): void {
    if (!this.isCurrent(session)) {
      return;
    }
    const { log, queue } = observation;
    const patch = this.getObservationPatch(session, observation);
    if (observation.cancelled && !session.confirmedNewLog && !isRunning(log)) {
      this.finish(session, {
        ...patch,
        outcome: "aborted",
        detail: "The queued scan was cancelled in Jenkins."
      });
      return;
    }
    if (isRunning(log)) {
      session.queueId = undefined;
      session.confirmedNewLog = true;
      session.trackCompletion = true;
      session.lastEvidenceAt = Date.now();
      session.errors = 0;
      this.publish(session, { ...patch, phase: "running" });
      this.schedule(session);
      return;
    }
    if (queue) {
      session.trackCompletion = true;
      session.lastEvidenceAt = Date.now();
      session.errors = 0;
      this.publish(session, {
        ...patch,
        phase: "queued",
        detail: queue.reason ?? "Waiting in the Jenkins queue."
      });
      this.schedule(session);
      return;
    }
    if (log && this.hasCompletedLog(session, log)) {
      this.finish(session, { ...patch, outcome: logOutcome(log.text) });
      return;
    }
    if (initial && !session.submitted && !observation.logError && !observation.queueError) {
      this.publish(session, {
        ...patch,
        phase: "unavailable",
        detail:
          log?.textSize === 0
            ? "No indexing log is available yet."
            : "Jenkins did not provide enough evidence to determine scan status."
      });
      this.stop(session);
      return;
    }
    this.retryObservation(session, observation, patch);
  }

  private getObservationPatch(
    session: ScanSession,
    observation: Observation
  ): Partial<MultibranchScanState> {
    const { log, logError } = observation;
    const previous = session.state.log;
    const replaced = Boolean(log && previous && logReplaced(previous, log));
    return {
      log: log ?? previous,
      logError: logError ? errorMessage(logError) : undefined,
      logRevision: session.state.logRevision + (replaced ? 1 : 0),
      detail: replaced ? "The indexing log was replaced by a later scan." : undefined
    };
  }

  private hasCompletedLog(session: ScanSession, log: JenkinsIndexingLog): boolean {
    const changed = Boolean(
      session.baseline &&
        log.source === session.baseline.source &&
        log.fingerprint !== session.baseline.fingerprint
    );
    if (session.baseline && log.source !== session.baseline.source) {
      // Progressive and fallback snapshots can differ in offsets, line endings,
      // and sampling even for the same log. Establish a comparable baseline.
      session.baseline = log;
    }
    // An attachment that has never seen active work may recover to the historical
    // completed log after an initial request failure. It must not announce completion.
    const historicalAttachment = !session.submitted && !session.trackCompletion;
    const belongsToScan = historicalAttachment || session.confirmedNewLog || changed;
    return log.moreData === false && log.textSize > 0 && belongsToScan;
  }

  private retryObservation(
    session: ScanSession,
    observation: Observation,
    patch: Partial<MultibranchScanState>
  ): void {
    const { log } = observation;
    if (observation.logError || observation.queueError || log?.moreData === undefined) {
      session.errors += 1;
      if (session.errors >= this.maxConsecutiveErrors) {
        this.publish(session, {
          ...patch,
          phase: "unavailable",
          detail: `Scan tracking stopped: ${errorMessage(observation.logError ?? observation.queueError ?? "Jenkins did not provide progressive log status.")} Open View Scan Log to retry.`
        });
        this.stop(session);
        return;
      }
    } else {
      session.errors = 0;
    }
    if (Date.now() - session.lastEvidenceAt >= this.evidenceTimeoutMs) {
      this.publish(session, {
        ...patch,
        phase: "unavailable",
        detail:
          "Could not distinguish the requested scan from the previous indexing log. Open View Scan Log to reconnect."
      });
      this.stop(session);
      return;
    }
    this.publish(session, {
      ...patch,
      detail: observation.logError
        ? "Unable to update the indexing log; retrying."
        : "Waiting for evidence of the requested scan."
    });
    this.schedule(session, Math.min(30_000, this.pollIntervalMs * 2 ** session.errors));
  }

  private finish(session: ScanSession, patch: Partial<MultibranchScanState>): void {
    this.publish(session, { ...patch, phase: "completed" });
    this.stop(session);
    if (session.trackCompletion) {
      this.completionEmitter.fire(session.state);
    }
  }

  private publish(session: ScanSession, patch: Partial<MultibranchScanState>): void {
    if (!this.isCurrent(session)) {
      return;
    }
    session.state = { ...session.state, ...patch, observedAt: Date.now() };
    this.stateStore.set(session.state);
  }

  private schedule(session: ScanSession, delay = this.pollIntervalMs): void {
    if (!this.isCurrent(session)) {
      return;
    }
    session.timer = setTimeout(() => {
      session.timer = undefined;
      void this.observe(session).then((observation) => this.reconcile(session, observation));
    }, delay);
  }

  private stop(session: ScanSession): void {
    session.stopped = true;
    session.abort.abort();
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = undefined;
    }
    if (this.sessions.get(session.key) === session) {
      this.sessions.delete(session.key);
    }
  }

  private isCurrent(session: ScanSession): boolean {
    return !this.disposed && !session.stopped && this.sessions.get(session.key) === session;
  }

  private environmentKey(environment: JenkinsEnvironmentRef): string {
    return JSON.stringify([environment.scope, environment.environmentId, environment.url]);
  }

  private getQueue(environment: JenkinsEnvironmentRef): Promise<JenkinsQueueItemInfo[]> {
    const key = this.environmentKey(environment);
    const generation = this.environmentGenerations.get(environment.environmentId) ?? 0;
    const existing = this.queueRequests.get(key);
    if (existing && (existing.pending || Date.now() - existing.at < this.pollIntervalMs)) {
      return existing.promise;
    }
    const promise = this.limit(() => {
      if (
        this.disposed ||
        generation !== (this.environmentGenerations.get(environment.environmentId) ?? 0)
      ) {
        throw new Error("Scan tracking stopped.");
      }
      return this.dataService.getQueueItems(environment);
    });
    const entry = { at: Date.now(), pending: true, promise };
    this.queueRequests.set(key, entry);
    void promise.then(
      () => {
        entry.pending = false;
      },
      () => {
        entry.pending = false;
      }
    );
    return promise;
  }

  private async limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.activeRequests += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) {
        next();
      } else {
        this.activeRequests -= 1;
      }
    }
  }
}

function isRunning(log: JenkinsIndexingLog | undefined): boolean {
  return Boolean(log && log.moreData === true && log.textSize > 0 && log.text.length > 0);
}

function logReplaced(previous: JenkinsIndexingLog, next: JenkinsIndexingLog): boolean {
  if (previous.source !== next.source) {
    return false;
  }
  return (
    next.textSize < previous.textSize ||
    Boolean(
      previous.prefix &&
        next.prefix &&
        !previous.prefix.startsWith(next.prefix) &&
        !next.prefix.startsWith(previous.prefix)
    )
  );
}

function logOutcome(text: string): MultibranchScanOutcome {
  const filter = new JenkinsConsoleNoteFilter();
  const plain = filter.append(text) + filter.finish();
  const result = /(?:^|\n)Finished: (SUCCESS|FAILURE|ABORTED|UNSTABLE|NOT_BUILT)\s*$/.exec(
    plain
  )?.[1];
  switch (result) {
    case "SUCCESS":
      return "success";
    case "ABORTED":
      return "aborted";
    case "FAILURE":
    case "UNSTABLE":
    case "NOT_BUILT":
      return "failure";
    default:
      return "unknown";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
