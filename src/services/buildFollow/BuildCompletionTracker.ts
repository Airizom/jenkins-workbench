import * as vscode from "vscode";
import { formatCompletionStatus } from "../../formatters/CompletionFormatters";
import { formatActionError } from "../../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsBuildDetails, JenkinsQueueItem } from "../../jenkins/types";
import {
  formatQueueTaskUrlLabel,
  type JenkinsBuildUrlSource,
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment
} from "../../jenkins/urls";
import {
  buildResultsCompatible,
  isBuildQueueId,
  requestStartedAfterNotice
} from "../../shared/build/BuildCompletionEvidence";
import { withActionErrorMessage } from "../../ui/ActionErrorMessage";
import { createPollBackoff, isNotFoundError, isTerminalClientError } from "../polling/Polling";
import {
  type EndpointConsumer,
  type FollowEntry,
  type FollowTarget,
  type PreviousCompletion,
  type PriorResult,
  type QueueCancellationWatch,
  type QueueIdentityRead,
  type RunStatus,
  rememberRunEndpoint,
  type TerminalObservation
} from "./BuildFollowEntry";
import {
  BuildFollowRegistry,
  buildKey,
  type FollowBinding,
  queueKey,
  sameController
} from "./BuildFollowRegistry";

export type { QueueCancellationWatch } from "./BuildFollowEntry";

import { nextBuildObservationOrder } from "./BuildFollowObservationOrder";
import type {
  FollowBuildResult,
  FollowedBuild,
  FollowedBuildActions,
  FollowedBuildCompletion,
  FollowedQueueItem,
  PanelCompletionDecision,
  PanelCompletionRequest,
  TriggeredBuildLocation
} from "./BuildFollowTypes";
import {
  type QueueExecutable,
  QueueItemEvidence,
  type QueueObservation,
  resolveFollowedQueueItem,
  type SubmittedQueueObservations
} from "./FollowedQueueBuild";
import { StartedBuildCompletionWatch } from "./StartedBuildCompletionWatch";

export const SHOW_FOLLOWED_BUILDS_COMMAND = "jenkinsWorkbench.showFollowedBuilds";

const DEFAULT_INITIAL_POLL_MS = 10_000;
const DEFAULT_MAX_POLL_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;

const VIEW_BUILD_DETAILS_ACTION = "View Build Details";
const PREVIEW_LOG_ACTION = "Preview Log";
const OPEN_BUILD_DETAILS_ACTION = "Open Build Details";
const STOP_FOLLOWING_ACTION = "Stop following";

export interface BuildCompletionTrackerActions extends FollowedBuildActions {
  refreshEnvironment(environmentId: string): void;
  isCurrentController(environment: JenkinsEnvironmentRef): boolean;
}

export interface BuildCompletionTrackerOptions {
  initialPollMs?: number;
  maxPollMs?: number;
  maxConsecutiveErrors?: number;
}

type CompletionDelivery = "requested" | "previously-notified";
type CompletionClaim =
  | PanelCompletionDecision
  | { disposition: "pending"; terminal: TerminalObservation };
const trackerDelivery = { disposition: "tracker" } as const;
const panelDelivery = { disposition: "panel" } as const;
const alreadyHandled = { disposition: "handled" } as const;

interface QueueAssignment {
  build: QueueExecutable;
  routeOwner?: ReturnType<typeof observeIncumbent>;
}

interface StartedBuildRead {
  prior: FollowEntry;
  observed: ReturnType<typeof observeIncumbent>;
  pending: FollowEntry | undefined;
  expectedId: number | undefined;
}

interface FollowPickerItem<T> extends vscode.QuickPickItem {
  value: T;
}

/** The successful submission is evidence only while its queue discovery is active. */
export interface SubmittedQueueDiscovery {
  observations?: SubmittedQueueObservations;
  finish(outcome?: TriggeredBuildLocation): void;
}

interface QueueSubmissions {
  evidence: QueueItemEvidence;
  /** True until the observer loses its queue item and can only use another live read. */
  observers: Map<SubmittedQueueDiscovery, boolean>;
  settled: Promise<void>;
  settle(): void;
}

function startQueueRead(): QueueIdentityRead {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { waiters: new Set(), settled, settle };
}

function rememberRunStatus(
  entry: FollowEntry,
  requestUrl: string,
  details: Pick<JenkinsBuildDetails, "queueId" | "building"> & { requestOrder?: number }
): void {
  rememberRunEndpoint(entry, requestUrl, details.queueId, details.requestOrder);
  if (details.building === true && details.requestOrder !== undefined)
    entry.latestRunningOrder = Math.max(entry.latestRunningOrder, details.requestOrder);
  if (
    details.building === true &&
    requestStartedAfterNotice(details.requestOrder, entry.deliveredPanelNotice?.noticeOrder)
  )
    entry.deliveredPanelNotice = undefined;
  const previous = entry.previousCompletion;
  if (
    !previous ||
    (previous.noticeOrder !== undefined &&
      !requestStartedAfterNotice(details.requestOrder, previous.noticeOrder))
  )
    return;
  if (
    details.building === true ||
    (isBuildQueueId(previous.queueId) &&
      isBuildQueueId(details.queueId) &&
      details.queueId !== previous.queueId)
  )
    entry.previousCompletion = undefined;
}

function latestKnownOrder(...orders: Array<number | undefined>): number | undefined {
  return Math.max(...orders.map((order) => order ?? 0)) || undefined;
}

function latestIdentityOrder(consumer: EndpointConsumer): number {
  return Math.max(consumer.latestRunningOrder, consumer.latestIdentityOrder ?? 0);
}

function servesLiteral(consumer: EndpointConsumer | undefined, build: FollowedBuild): boolean {
  return Boolean(
    consumer &&
      "buildUrl" in consumer.target &&
      normalizeJenkinsUrlForComparison(consumer.target.buildUrl, build.environment.url) ===
        normalizeJenkinsUrlForComparison(build.buildUrl, build.environment.url)
  );
}

function isExactTerminal(entry: FollowEntry, number: number, status: RunStatus): boolean {
  return (
    status.building === false &&
    status.number === number &&
    isBuildQueueId(status.queueId) &&
    status.queueId === entry.runQueueId
  );
}

function supersededStatus(entry: FollowEntry, number: number, status: RunStatus): boolean {
  return (
    status.requestOrder < latestIdentityOrder(entry) && !isExactTerminal(entry, number, status)
  );
}

function staleRunStatus(
  entry: FollowEntry,
  number: number,
  initialQueueId: number | undefined,
  status: RunStatus
): boolean {
  return (
    supersededStatus(entry, number, status) ||
    (initialQueueId !== entry.runQueueId &&
      (status.queueId !== entry.runQueueId || status.number !== number))
  );
}

function observedRunId(entry: FollowEntry, build: FollowedBuild): number | undefined {
  return entry.observedRunIds?.get(
    normalizeJenkinsUrlForComparison(build.buildUrl, build.environment.url)
  )?.queueId;
}

function matchesPreviousCompletion(
  previous: PreviousCompletion | undefined,
  result: string | undefined,
  queueId: number | undefined
): boolean {
  return (
    previous !== undefined &&
    previous.result === result &&
    (!isBuildQueueId(previous.queueId) || !isBuildQueueId(queueId) || previous.queueId === queueId)
  );
}

function matchesPanelVerification(entry: FollowEntry, number: number, status: RunStatus): boolean {
  return (
    status.number === number &&
    !supersededStatus(entry, number, status) &&
    (entry.statusConflictOrder === undefined || isExactTerminal(entry, number, status)) &&
    (!isBuildQueueId(status.queueId) || status.queueId === entry.runQueueId)
  );
}

function extendTerminalReadOrder(terminal: TerminalObservation, requestOrder?: number): void {
  if (requestOrder === undefined) return;
  terminal.statusRequestOrder = Math.max(terminal.statusRequestOrder ?? 0, requestOrder);
  terminal.build = {
    ...terminal.build,
    requestOrder: Math.max(terminal.build.requestOrder ?? 0, terminal.statusRequestOrder)
  };
}

function snapshotCompletedQueueIds(entry: FollowEntry): number[] | undefined {
  const { completedQueues } = entry;
  return completedQueues && [...completedQueues.keys()];
}

function noticeForQueue(entry: FollowEntry, id?: number): PriorResult | undefined {
  if (id === undefined) return undefined;
  return (
    (entry.completedQueues?.get(id)?.noticeOrder === undefined
      ? undefined
      : entry.completedQueues.get(id)) ??
    (entry.announcedAtUrl?.queueId === id ? entry.announcedAtUrl : undefined)
  );
}

function compatibleCompletion(
  left: Pick<TerminalObservation, "queueId" | "result">,
  right: Pick<TerminalObservation, "queueId" | "result">
): boolean {
  return (
    buildResultsCompatible(left.result, right.result) &&
    (left.queueId === undefined || right.queueId === undefined || left.queueId === right.queueId)
  );
}

function resolvePanelClaim(terminal: TerminalObservation, decision: PanelCompletionDecision): void {
  terminal.resolvePanelClaim?.(decision);
}

function mergePanelClaims(existing: TerminalObservation, terminal: TerminalObservation): void {
  terminal.previouslyDelivered ||= existing.previouslyDelivered;
  const claim = existing.resolvePanelClaim;
  if (claim && terminal.resolvePanelClaim !== claim) {
    resolvePanelClaim(terminal, alreadyHandled);
    terminal.resolvePanelClaim = claim;
  }
}

function matchingNumberedNotice(
  entry: FollowEntry,
  result?: string,
  queueId?: number
): PreviousCompletion | undefined {
  const prior = entry.announcedAtUrl;
  if (!prior || result !== prior.result) return undefined;
  const same = isBuildQueueId(queueId)
    ? queueId === prior.queueId
    : prior.noticeOrder !== undefined &&
      !requestStartedAfterNotice(entry.latestRunningOrder, prior.noticeOrder);
  return same ? prior : undefined;
}

function previousCompletionNotice(entry: FollowEntry, terminal: TerminalObservation, id?: number) {
  const priorQueue = noticeForQueue(entry, id);
  const panelNotice = entry.deliveredPanelNotice;
  const matchingPanelNotice =
    panelNotice?.result === terminal.result &&
    !requestStartedAfterNotice(entry.latestRunningOrder, panelNotice?.noticeOrder)
      ? panelNotice
      : undefined;
  return matchesPreviousCompletion(terminal.previousCompletion, terminal.result, id)
    ? terminal.previousCompletion
    : (matchingNumberedNotice(entry, terminal.result, id) ??
        (priorQueue && buildResultsCompatible(priorQueue.result, terminal.result)
          ? priorQueue
          : undefined) ??
        matchingPanelNotice);
}

function actionEvidence(entry: FollowEntry, build: FollowedBuild, queueId?: number) {
  const observed = observedRunId(entry, build);
  return {
    queueId: queueId ?? observed ?? entry.observedPanelIdentity?.queueId,
    requireQueueId:
      observed !== undefined || (servesLiteral(entry, build) && Boolean(entry.requireQueueId))
  };
}

function buildActionTarget(
  build: FollowedBuild,
  status: RunStatus,
  expectedId: number | undefined
) {
  const queueId = isBuildQueueId(status.queueId) ? status.queueId : expectedId;
  return {
    ...build,
    ...(isBuildQueueId(queueId) && { queueId }),
    ...(isBuildQueueId(status.queueId) && { requireQueueId: true }),
    ...(status.building === false && { completion: { result: status.result } })
  };
}

function matchesCompletionSelection(
  build: FollowedBuild,
  status: RunStatus | undefined,
  current: FollowEntry | undefined,
  consumer: EndpointConsumer,
  result: string | undefined
): status is RunStatus {
  if (status?.number !== build.buildNumber || consumer.statusConflictOrder !== undefined)
    return false;
  if (current?.runQueueId !== undefined && current.runQueueId !== build.queueId) return false;
  if (isBuildQueueId(status.queueId)) return status.queueId === build.queueId;
  return (
    !consumer.requireQueueId && !current && status.building === false && status.result === result
  );
}

function observeIncumbent(entry?: FollowEntry) {
  return { entry, queueId: entry?.runQueueId, request: entry?.statusRequest };
}

function ownershipChangedDuringRead(
  observed: ReturnType<typeof observeIncumbent>,
  current: FollowEntry | undefined,
  expectedOwner: FollowEntry | undefined,
  build: FollowedBuild,
  queueId: number | undefined,
  status: RunStatus | undefined
): boolean {
  if (!current || (queueId !== undefined && current.runQueueId === queueId)) return false;
  if (current !== observed.entry) return current !== expectedOwner;
  if (current.runQueueId === observed.queueId || current.runQueueId === status?.queueId)
    return false;
  // A poll that predates verification may have identified the incumbent in the meantime.
  return !(
    observed.queueId === undefined &&
    observed.request &&
    status &&
    observedRunId(current, build) === current.runQueueId &&
    current.latestRunningOrder < status.requestOrder
  );
}

function canReuseStartedSubscription(
  prior: FollowEntry,
  target: FollowedBuild,
  expectedId: number | undefined
): boolean {
  return (
    !prior.statusRequest &&
    prior.runQueueId === expectedId &&
    (expectedId !== undefined ||
      ("buildUrl" in prior.target && prior.target.buildUrl === target.buildUrl))
  );
}

function verifiedQueueAlternate(
  evidence: QueueItemEvidence | undefined,
  advertised: FollowedBuild
) {
  const candidate = evidence?.alternateFor(advertised);
  return candidate?.queueStatus && candidate.buildUrl !== advertised.buildUrl
    ? candidate
    : undefined;
}

function followLabel(target: FollowTarget): string {
  return "buildUrl" in target ? target.label : `${target.label} (queue #${target.queueId})`;
}

function describeQueueTask(queue: FollowedQueueItem): FollowedQueueItem {
  const label = queue.taskUrl && formatQueueTaskUrlLabel(queue.environment.url, queue.taskUrl);
  return label ? { ...queue, label } : queue;
}

/** Tracks one non-overlapping poll chain per queue item or running build in this window. */
export class BuildCompletionTracker implements vscode.Disposable {
  private readonly registry = new BuildFollowRegistry();
  // Only the panel decision whose notice is displayed can commit an uncertain outcome.
  private readonly pendingPanelPresentations = new WeakMap<
    PanelCompletionDecision,
    { entry: FollowEntry; requestOrder: number; result?: string }
  >();
  private readonly openEndpointActions = new Set<{ consumer: EndpointConsumer }>();
  private readonly queueSubmissions = new Map<string, QueueSubmissions>();
  private readonly queueCancellations = new Map<string, { observers: number; claimed: boolean }>();
  private readonly changes = new vscode.EventEmitter<void>();
  private readonly userStops = new vscode.EventEmitter<FollowEntry>();
  readonly onDidChange = this.changes.event;
  private readonly completions = new vscode.EventEmitter<FollowedBuildCompletion>();
  readonly onDidNotifyCompletion = this.completions.event;
  private readonly initialPollMs: number;
  private readonly maxPollMs: number;
  private readonly maxConsecutiveErrors: number;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private disposed = false;

  constructor(
    private readonly dataService: Pick<JenkinsDataService, "getBuildDetails" | "getQueueItem">,
    private readonly actions: BuildCompletionTrackerActions,
    options?: BuildCompletionTrackerOptions
  ) {
    this.initialPollMs = Math.max(0, options?.initialPollMs ?? DEFAULT_INITIAL_POLL_MS);
    this.maxPollMs = Math.max(this.initialPollMs, options?.maxPollMs ?? DEFAULT_MAX_POLL_MS);
    this.maxConsecutiveErrors = Math.max(
      1,
      options?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS
    );
  }

  get count(): number {
    return this.registry.size;
  }

  isFollowingBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    source: JenkinsBuildUrlSource = "reported"
  ): boolean {
    return this.registry.lookup(buildKey(environment, buildUrl, source)) !== undefined;
  }

  isFollowingQueueItem(environment: JenkinsEnvironmentRef, queueId: number): boolean {
    const key = queueKey(environment, queueId);
    return this.registry.lookup(key) !== undefined;
  }

  /** Compare a cached panel observation without changing a newer subscription at a reused URL. */
  getObservedBuildState(build: FollowedBuild): "following" | "available" | "conflict" {
    const target = this.resolveTarget(build, "configured");
    if (!target) return "conflict";
    const key = buildKey(target.environment, target.buildUrl);
    const direct = this.registry.lookup(key);
    if (!isBuildQueueId(build.queueId)) return direct ? "following" : "available";
    const queued = this.registry.lookup(queueKey(build.environment, build.queueId));
    if (queued && this.registry.isRetired(queued, key)) return "conflict";
    if (queued && "buildUrl" in queued.target)
      return queued.target.buildNumber === build.buildNumber ? "following" : "conflict";
    if (queued && !queued.endedBuilds?.has(key)) return "following";
    return direct ? "conflict" : "available";
  }

  followObservedBuild(build: FollowedBuild): FollowBuildResult {
    const state = this.getObservedBuildState(build);
    if (state === "conflict") return "unidentified";
    const outcome = state === "following" ? "already-following" : this.follow(build, "configured");
    if (isBuildQueueId(build.queueId))
      rememberRunEndpoint(
        this.registry.lookup(queueKey(build.environment, build.queueId)),
        build.observedUrl ?? build.buildUrl,
        build.queueId,
        build.requestOrder
      );
    return outcome;
  }

  stopFollowingObservedBuild(build: FollowedBuild): void {
    if (this.getObservedBuildState(build) !== "following") return;
    const direct = this.registry.lookup(buildKey(build.environment, build.buildUrl));
    const queue = isBuildQueueId(build.queueId)
      ? this.registry.lookup(queueKey(build.environment, build.queueId))
      : undefined;
    this.remove(queue ?? direct, "user-stop");
  }

  /** Fresh identity from the literal panel request is independent of notification ownership. */
  observeBuildIdentity(build: FollowedBuild, building?: boolean, superseded = false): void {
    const requestOrder = build.requestOrder ?? nextBuildObservationOrder();
    const literal = build.observedUrl ?? build.buildUrl;
    const entry = this.registry.lookup(buildKey(build.environment, build.buildUrl));
    if (
      !superseded &&
      entry &&
      entry.runQueueId === undefined &&
      isBuildQueueId(build.queueId) &&
      this.registry.matchesRun(entry, build.buildNumber, build.queueId)
    ) {
      rememberRunEndpoint(entry, literal, build.queueId, requestOrder);
      if (requestOrder >= (entry.observedPanelIdentity?.requestOrder ?? 0))
        entry.observedPanelIdentity = { queueId: build.queueId, requestOrder };
    }
    if (
      !superseded &&
      normalizeJenkinsUrlForComparison(literal, build.environment.url) ===
        normalizeJenkinsUrlForComparison(build.buildUrl, build.environment.url)
    )
      this.observeSubmittedExecutable(build, build.queueId, requestOrder);
    this.observeEndpointIdentity(
      build.environment,
      literal,
      build.buildNumber,
      build.queueId,
      requestOrder,
      building
    );
  }

  /** The panel has already resolved this request to a numbered endpoint on its controller. */
  observeRunningBuild(build: FollowedBuild, fresh = false): void {
    if (this.disposed) return;
    const requestOrder = fresh ? (build.requestOrder ?? nextBuildObservationOrder()) : undefined;
    if (fresh) this.observeBuildIdentity({ ...build, requestOrder }, true);
    const target = this.resolveTarget(build, "configured");
    if (!target) return;
    const key = buildKey(target.environment, target.buildUrl);
    const direct = this.registry.lookup(key);
    const observedUrl = build.observedUrl ?? build.buildUrl;
    const observation = {
      building: true,
      queueId: build.queueId,
      requestOrder
    };
    if (!isBuildQueueId(build.queueId) || (direct && direct.runQueueId === undefined)) {
      // A panel identity helps open actions. The subscription confirms ownership independently.
      if (fresh && direct && this.registry.matchesRun(direct, target.buildNumber, build.queueId))
        rememberRunStatus(direct, observedUrl, observation);
      return;
    }
    this.matchRunningBuild(
      target,
      build.queueId,
      fresh ? { url: observedUrl, requestOrder } : undefined
    );
  }

  rejectMismatchedBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    observedNumber: number,
    requestOrder = nextBuildObservationOrder()
  ): void {
    this.observeEndpointIdentity(environment, buildUrl, observedNumber, undefined, requestOrder);
    const key = buildKey(environment, buildUrl);
    const entry = this.registry.lookup(key);
    if (
      !entry ||
      !this.canUseEntry(entry) ||
      requestOrder < latestIdentityOrder(entry) ||
      (key === entry.key &&
        "buildUrl" in entry.target &&
        normalizeJenkinsUrlForComparison(buildUrl, environment.url) !==
          normalizeJenkinsUrlForComparison(entry.target.buildUrl, environment.url))
    )
      return;
    const waiting =
      entry.key === key
        ? this.settleStatusConflict(entry, { number: observedNumber, requestOrder })
        : undefined;
    if (!waiting) {
      this.verifyRunAtUrl(key, entry, observedNumber);
      return;
    }
    void waiting.then(() => {
      if (
        this.registry.lookup(key) === entry &&
        this.canUseEntry(entry) &&
        entry.statusConflictOrder !== undefined &&
        requestOrder >= latestIdentityOrder(entry)
      )
        this.verifyRunAtUrl(key, entry, observedNumber);
    });
  }

  private resolveTarget(
    build: FollowedBuild,
    source: JenkinsBuildUrlSource
  ): FollowedBuild | undefined {
    const identity = resolveBuildIdentityForEnvironment(
      build.environment.url,
      build.buildUrl,
      "request",
      build,
      source
    );
    return identity?.buildNumber === build.buildNumber
      ? { environment: build.environment, ...identity }
      : undefined;
  }

  private matchRunningBuild(
    target: FollowedBuild,
    id: number,
    observation?: { url: string; requestOrder?: number }
  ): FollowBuildResult | undefined {
    const key = buildKey(target.environment, target.buildUrl);
    const entry = this.registry.lookup(key);
    if (entry) return this.matchRunningEntry(entry, target, id, observation);
    const queue = this.registry.lookup(queueKey(target.environment, id));
    if (!queue) return undefined;
    if (!this.canUseEntry(queue) || this.registry.isRetired(queue, key)) return "unidentified";
    if ("buildUrl" in queue.target && queue.target.buildNumber !== target.buildNumber)
      return "unidentified";
    if (observation)
      rememberRunStatus(queue, observation.url, {
        building: true,
        queueId: id,
        requestOrder: observation.requestOrder
      });
    if ("buildUrl" in queue.target) {
      this.attachExecutableAlias(queue, target, id);
    } else {
      this.handoff(queue, target);
    }
    return this.registry.lookup(key) ? "already-following" : undefined;
  }

  private matchRunningEntry(
    entry: FollowEntry,
    target: FollowedBuild,
    id: number,
    observation?: { url: string; requestOrder?: number }
  ): FollowBuildResult {
    if (!this.canUseEntry(entry) || !this.registry.matchesRun(entry, target.buildNumber, id))
      return "unidentified";
    if (observation)
      rememberRunStatus(entry, observation.url, {
        building: true,
        queueId: id,
        requestOrder: observation.requestOrder
      });
    if (noticeForQueue(entry, id)) {
      if (entry.deferredCompletion)
        this.releaseDeferredObservation(
          entry,
          this.alreadyAnnounced(entry, id, entry.deferredCompletion)
            ? alreadyHandled
            : panelDelivery
        );
      this.finishFollow(target, undefined, id, "previously-notified", entry);
      return "already-following";
    }
    this.bindRunQueue(entry, target, id);
    return "already-following";
  }

  follow(build: FollowedBuild, source: JenkinsBuildUrlSource = "reported"): FollowBuildResult {
    return this.subscribeBuild(build, source);
  }

  private subscribeBuild(
    build: FollowedBuild,
    source: JenkinsBuildUrlSource,
    previousCompletion?: PreviousCompletion
  ): FollowBuildResult {
    if (this.disposed) return "disposed";
    const target = this.resolveTarget(build, source);
    if (!target) {
      void vscode.window.showWarningMessage(
        `Unable to follow ${build.label}: Jenkins did not identify the exact build on this controller.`
      );
      return "unidentified";
    }
    const id = isBuildQueueId(build.queueId) ? build.queueId : undefined;
    if (id !== undefined) {
      const match = this.matchRunningBuild(target, id);
      if (match) return match;
    }
    return this.add(
      buildKey(target.environment, target.buildUrl),
      target,
      id,
      undefined,
      previousCompletion
    )
      ? "following"
      : "already-following";
  }

  /** A choice made on an earlier started banner must still identify the currently served run. */
  async followStartedBuild(
    { verifiedTerminal, ...build }: FollowedBuild & { verifiedTerminal?: RunStatus },
    source: JenkinsBuildUrlSource = "reported",
    observedRunQueueId?: number,
    previousCompletion?: PreviousCompletion
  ): Promise<FollowBuildResult> {
    if (this.disposed) return "disposed";
    if (!this.actions.isCurrentController(build.environment)) return "unidentified";
    const target = this.resolveTarget(build, source);
    if (!target) return this.subscribeBuild(build, source, previousCompletion);
    // Endpoint selection can already have read the exact completed run. It may no longer exist
    // when the user accepts the started banner, while its queue receipt still identifies it.
    if (
      verifiedTerminal?.building === false &&
      verifiedTerminal.number === target.buildNumber &&
      isBuildQueueId(verifiedTerminal.queueId) &&
      verifiedTerminal.queueId === observedRunQueueId &&
      verifiedTerminal.queueId === build.queueId
    ) {
      const { result, queueId, requestOrder } = verifiedTerminal;
      const completed = { ...target, result, queueId, requestOrder };
      const prior = matchesPreviousCompletion(previousCompletion, result, queueId);
      const claim = await this.claimPanelCompletion({
        notice: completed,
        previouslyDelivered: prior
      });
      if (
        claim.disposition === "panel" &&
        !this.disposed &&
        this.actions.isCurrentController(build.environment)
      ) {
        this.publishCompletionIdentity(completed, queueId, result, []);
        this.notifyCompletion(completed, result, queueId, true);
      }
      return "following";
    }
    if (!isBuildQueueId(observedRunQueueId) || observedRunQueueId !== build.queueId)
      return this.subscribeStartedBuild(build, source, target, previousCompletion);
    const preserveCauseIdentity = () =>
      this.observeEndpointIdentity(
        target.environment,
        target.buildUrl,
        target.buildNumber,
        observedRunQueueId
      );
    preserveCauseIdentity();
    const binding = this.onDidChange(preserveCauseIdentity);
    try {
      return await this.subscribeStartedBuild(build, source, target, previousCompletion);
    } finally {
      binding.dispose();
    }
  }

  private async subscribeStartedBuild(
    build: FollowedBuild,
    source: JenkinsBuildUrlSource,
    target: FollowedBuild,
    previousCompletion?: PreviousCompletion
  ): Promise<FollowBuildResult> {
    const key = buildKey(build.environment, target.buildUrl);
    const prior = this.registry.lookup(key);
    const expectedId = isBuildQueueId(build.queueId) ? build.queueId : undefined;
    const queue = expectedId === undefined ? undefined : queueKey(build.environment, expectedId);
    const pending = queue === undefined ? undefined : this.registry.lookup(queue);
    if (!prior || canReuseStartedSubscription(prior, target, expectedId))
      return this.subscribeBuild(build, source, previousCompletion);
    const observed = observeIncumbent(prior);
    const notices = new StartedBuildCompletionWatch(
      this.onDidNotifyCompletion,
      target.environment,
      expectedId
    );
    if (previousCompletion) notices.possibleCompletion = { ...target, ...previousCompletion };
    notices.identify({ ...target, queueId: expectedId }, "configured");
    let stopped = false;
    const stop = this.userStops.event((entry) => {
      if (entry === this.registry.lookup(key) || (queue && entry === this.registry.lookup(queue)))
        stopped = true;
    });
    let details: RunStatus | undefined;
    try {
      details = await this.readBuildStatus(target, expectedId).catch(() => undefined);
      if (details && this.canUseEntry(prior)) {
        const conflict = this.settleStatusConflict(prior, details);
        if (conflict) await conflict;
      }
      const competing = this.waitForStartedBuildConflict(target, details, {
        prior,
        observed,
        pending,
        expectedId
      });
      if (competing) await competing;
    } finally {
      stop.dispose();
      notices.dispose();
    }
    if (this.disposed) return "disposed";
    if (stopped || !this.actions.isCurrentController(build.environment)) return "unidentified";
    return this.applyStartedStatus(build, source, target, details, {
      prior,
      observed,
      pending,
      expectedId,
      notices
    });
  }

  private waitForStartedBuildConflict(
    target: FollowedBuild,
    details: RunStatus | undefined,
    { prior, observed, pending, expectedId }: StartedBuildRead
  ): Promise<void> | undefined {
    if (!details || details.number !== target.buildNumber) return undefined;
    if (
      expectedId === undefined &&
      (!isBuildQueueId(details.queueId) || details.queueId !== observed.queueId)
    ) {
      // Until both reads identify their runs, the older subscription can own a separate result.
      return this.waitForObservedRequest(prior, observed, true) ?? Promise.resolve();
    }
    return this.waitForNumberedStatusConflict(pending ?? prior, observed, target, details);
  }

  private applyStartedStatus(
    build: FollowedBuild,
    source: JenkinsBuildUrlSource,
    target: FollowedBuild,
    details: RunStatus | undefined,
    context: StartedBuildRead & { notices: StartedBuildCompletionWatch }
  ): FollowBuildResult {
    const { prior, expectedId, notices } = context;
    const key = buildKey(build.environment, target.buildUrl);
    const queue = expectedId === undefined ? undefined : queueKey(build.environment, expectedId);
    const statusId = isBuildQueueId(details?.queueId) ? details.queueId : undefined;
    const id = expectedId ?? statusId;
    if (notices.notified || (id !== undefined && notices.possibleCompletion?.queueId === id))
      return "following";
    const current = this.registry.lookup(key);
    const existing = this.startedReadOutcome(
      target,
      details,
      current,
      id,
      statusId,
      queue,
      context
    );
    if (existing) return existing;
    if (!this.confirmsStartedRun(details, target, prior, current, expectedId, statusId)) {
      if (current && details) this.confirmUnidentifiedRun(current, details, target);
      void vscode.window.showWarningMessage(
        `Unable to follow ${build.label}: Jenkins could not confirm the run from the started notification.`
      );
      return "unidentified";
    }
    return this.adoptStartedRun(
      build,
      source,
      target,
      details,
      key,
      current,
      id,
      notices.possibleCompletion
    );
  }

  private startedReadOutcome(
    target: FollowedBuild,
    details: RunStatus | undefined,
    current: FollowEntry | undefined,
    id: number | undefined,
    statusId: number | undefined,
    queue: string | undefined,
    { prior, observed, pending, expectedId }: StartedBuildRead
  ): FollowBuildResult | undefined {
    if (current && details && supersededStatus(current, target.buildNumber, details)) {
      return current.runQueueId !== undefined && current.runQueueId === id
        ? "already-following"
        : "unidentified";
    }
    if (
      current &&
      expectedId !== undefined &&
      current.runQueueId === expectedId &&
      (!details || details.number !== target.buildNumber || statusId !== expectedId)
    )
      return "already-following";
    const nowPending = queue === undefined ? undefined : this.registry.lookup(queue);
    if (
      ownershipChangedDuringRead(
        observed,
        current,
        pending ? this.registry.current(pending) : undefined,
        target,
        id,
        details
      ) ||
      (nowPending && nowPending !== this.registry.current(pending ?? prior))
    )
      return "unidentified";
    return undefined;
  }

  private confirmsStartedRun(
    details: RunStatus | undefined,
    target: FollowedBuild,
    prior: FollowEntry,
    current: FollowEntry | undefined,
    expectedId: number | undefined,
    statusId: number | undefined
  ): details is RunStatus {
    if (!details || details.number !== target.buildNumber) return false;
    if (expectedId !== undefined) {
      if (statusId !== undefined) return statusId === expectedId;
      if (current || this.registry.identifiesDifferentQueue(prior, expectedId)) return false;
    }
    return (
      statusId !== undefined ||
      (typeof details.building === "boolean" && current?.runQueueId === undefined)
    );
  }

  private adoptStartedRun(
    build: FollowedBuild,
    source: JenkinsBuildUrlSource,
    target: FollowedBuild,
    details: RunStatus,
    key: string,
    current: FollowEntry | undefined,
    id: number | undefined,
    previousCompletion: PreviousCompletion | undefined
  ): FollowBuildResult {
    if (current?.runQueueId !== undefined && id !== undefined && current.runQueueId !== id) {
      this.verifyRunAtUrl(key, current, details.number, id);
      const afterRelease = this.registry.lookup(key);
      if (afterRelease && afterRelease !== current && afterRelease.runQueueId !== id)
        return "unidentified";
    }
    const outcome = this.subscribeBuild({ ...build, queueId: id }, source, previousCompletion);
    const owner = this.registry.lookup(key);
    if (owner && (outcome === "following" || outcome === "already-following")) {
      if (owner.key === key && "buildUrl" in owner.target) owner.target = target;
      this.applyFollowedStatus(owner, target, details);
      if (this.registry.current(owner).completion) return "following";
    }
    return outcome;
  }

  /** Share a cancellation only across overlapping automatic discovery and explicit queue follows. */
  watchQueueCancellation(environment: JenkinsEnvironmentRef, id: number): QueueCancellationWatch {
    const key = queueKey(environment, id);
    const state = this.queueCancellations.get(key) ?? { observers: 0, claimed: false };
    let active = !this.disposed;
    if (active) {
      state.observers++;
      this.queueCancellations.set(key, state);
    }
    return {
      claim: () => {
        if (!active || this.disposed || state.claimed) return false;
        state.claimed = true;
        return true;
      },
      dispose: () => {
        if (!active) return;
        active = false;
        if (--state.observers === 0) this.queueCancellations.delete(key);
      }
    };
  }

  beginSubmittedQueueDiscovery(
    environment: JenkinsEnvironmentRef,
    id: number,
    jobUrl?: string
  ): SubmittedQueueDiscovery {
    const key = queueKey(environment, id);
    if (this.disposed || !isBuildQueueId(id)) return { finish() {} };
    let pending = this.queueSubmissions.get(key);
    if (!pending) {
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const followed = this.registry.lookup(key);
      const evidence =
        followed?.queueEvidence ?? new QueueItemEvidence({ environment, queueId: id, label: "" });
      if (followed && "buildUrl" in followed.target && followed.runQueueId === id) {
        evidence.recordOutcome(
          { kind: "started", build: followed.target },
          !followed.queueEvidence &&
            followed.observedRunIds?.get(
              normalizeJenkinsUrlForComparison(followed.target.buildUrl, environment.url)
            )?.queueId === id
        );
        followed.queueEvidence = evidence;
      }
      pending = { observers: new Map(), evidence, settled, settle };
      this.queueSubmissions.set(key, pending);
    }
    const submissions = pending;
    let close!: () => void;
    const closed = new Promise<QueueObservation>((resolve) => {
      close = () => resolve({ kind: "unknown" });
    });
    const discovery: SubmittedQueueDiscovery = {
      observations: {
        selectExecutable: (build, read, active) =>
          submissions.evidence.selectExecutable(
            build,
            read,
            () =>
              active() &&
              submissions.observers.has(discovery) &&
              this.actions.isCurrentController(environment)
          ),
        whenIdentified: Promise.race([submissions.evidence.whenIdentified, closed]),
        observe: (item) =>
          submissions.observers.has(discovery) && this.actions.isCurrentController(environment)
            ? submissions.evidence.observe(item)
            : { kind: "unknown" },
        afterPendingReads: async () => {
          if (!submissions.observers.has(discovery)) return;
          submissions.observers.set(discovery, false);
          await this.waitForQueueEvidence(environment, key, closed);
          return submissions.evidence.outcome;
        }
      },
      finish: (outcome) => {
        close();
        if (!submissions.observers.delete(discovery)) return;
        if (
          !this.disposed &&
          outcome?.kind === "started" &&
          sameController(environment, outcome.environment)
        ) {
          void this.acceptLocatedQueueBuild(outcome, id).catch((error) => {
            console.warn(`Failed to hand queue item #${id} to its build.`, error);
          });
        } else if (outcome?.kind === "cancelled") {
          const entry = this.registry.pendingQueue(key);
          if (entry && !("buildUrl" in entry.target) && this.canUseEntry(entry))
            this.cancelQueueFollow(entry, entry.target);
        }
        if (submissions.observers.size === 0) {
          this.queueSubmissions.delete(key);
          submissions.settle();
        }
      }
    };
    submissions.observers.set(discovery, true);
    submissions.evidence.rememberSubmittedJob(jobUrl);
    return discovery;
  }

  /** A numbered request already in progress can return the queue ID after Jenkins expires its item. */
  private async waitForQueueEvidence(
    environment: JenkinsEnvironmentRef,
    key: string,
    closed: Promise<QueueObservation>
  ): Promise<void> {
    const reads: Promise<unknown>[] = [];
    const owners: FollowEntry[] = [];
    for (const entry of this.registry.active()) {
      if (!sameController(entry.target.environment, environment)) continue;
      const started = reads.length;
      if (entry.key === key && entry.queueObservationEnd)
        reads.push(entry.queueObservationEnd.settled);
      if (entry.statusRequest) reads.push(entry.statusRequest);
      for (const request of entry.competingStatuses?.keys() ?? []) reads.push(request);
      if (started < reads.length) owners.push(entry);
    }
    if (reads.length) {
      let stopped!: () => void;
      const retired = new Promise<void>((resolve) => {
        stopped = resolve;
      });
      const listener = this.onDidChange(() => {
        if (owners.every((owner) => !this.registry.isActive(this.registry.current(owner))))
          stopped();
      });
      try {
        await Promise.race([Promise.allSettled(reads), retired, closed]);
      } finally {
        listener.dispose();
      }
    }
  }

  /** A fresh Run response can identify a submission even without a Follow Queue Item subscription. */
  private observeSubmittedExecutable(
    build: FollowedBuild,
    id: number | undefined,
    requestOrder: number
  ): void {
    if (this.disposed || !isBuildQueueId(id)) return;
    const key = queueKey(build.environment, id);
    const submissions = this.queueSubmissions.get(key);
    if (!submissions || !this.actions.isCurrentController(build.environment)) return;
    const target = this.resolveTarget(build, "configured");
    if (!target) return;
    const owner = this.registry.lookup(buildKey(target.environment, target.buildUrl));
    if (
      !Array.from(submissions.observers.values()).includes(true) &&
      !this.registry.pendingQueue(key) &&
      !owner?.statusRequest &&
      !owner?.competingStatuses?.size
    )
      return;
    if (owner && servesLiteral(owner, target)) {
      const latest = owner.observedRunIds?.get(
        normalizeJenkinsUrlForComparison(target.buildUrl, target.environment.url)
      );
      if (
        requestOrder < latestIdentityOrder(owner) ||
        (latest && requestOrder < latest.requestOrder && latest.queueId !== id)
      )
        return;
    }
    submissions.evidence.recordOutcome({ kind: "started", build: target }, true);
  }

  private cancelQueueFollow(entry: FollowEntry, queue: FollowedQueueItem): void {
    const notify = entry.cancellationWatch?.claim();
    this.remove(entry);
    if (notify)
      void vscode.window.showInformationMessage(
        `${followLabel(queue)} was cancelled in the queue.`
      );
  }

  followQueueItem(queue: FollowedQueueItem): boolean {
    if (!isBuildQueueId(queue.queueId)) {
      return false;
    }
    return this.add(queueKey(queue.environment, queue.queueId), describeQueueTask(queue));
  }

  /** Automatic queue discovery can supply the executable to an existing one-run follow. */
  async acceptLocatedQueueBuild(build: QueueExecutable, queueId: number): Promise<void> {
    if (
      this.disposed ||
      !isBuildQueueId(queueId) ||
      (isBuildQueueId(build.queueId) && build.queueId !== queueId)
    )
      return;
    const pending = this.registry.lookup(queueKey(build.environment, queueId));
    if (!pending || !this.canUseEntry(pending)) return;
    if ("buildUrl" in pending.target) {
      // Discovery may have proved the alternate before the handed-off run's first poll.
      // Any outstanding poll shares the verification and will make the same transition.
      const replacement = pending.queueEvidence?.alternateFor(pending.target);
      if (
        !pending.statusRequest &&
        replacement?.queueStatus &&
        replacement.buildUrl === build.buildUrl &&
        build.queueStatus?.queueId === queueId
      ) {
        clearEntryTimer(pending);
        await this.poll(pending);
      }
      return;
    }
    const target = this.resolveTarget(build, "configured");
    if (!target) return;
    const executable = {
      ...target,
      ...(build.fallbackUrl && { fallbackUrl: build.fallbackUrl }),
      ...(build.queueStatus && { queueStatus: build.queueStatus })
    };
    if (pending.queueRead) {
      pending.queueRead.locatedBuild = executable;
      pending.queueRead.provideExecutable?.(executable);
      return pending.queueRead.settled;
    }
    clearEntryTimer(pending);
    await this.poll(pending, executable);
  }

  private add(
    key: string,
    target: FollowTarget,
    runQueueId?: number,
    pending?: FollowEntry,
    previousCompletion?: PreviousCompletion
  ): boolean {
    if (this.disposed || this.registry.lookup(key)) {
      return false;
    }
    const entry: FollowEntry = {
      key,
      target,
      backoff: createPollBackoff(this.initialPollMs, this.maxPollMs),
      consecutiveErrors: 0,
      latestRunningOrder: nextBuildObservationOrder(),
      previousCompletion,
      runQueueId
    };
    if (!("buildUrl" in target)) {
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      entry.queueObservationEnd = { settled, settle };
      entry.queueEvidence =
        this.queueSubmissions.get(key)?.evidence ?? new QueueItemEvidence(target);
      entry.queueEvidence.observe({ id: target.queueId, task: { url: target.taskUrl } });
      entry.cancellationWatch = this.watchQueueCancellation(target.environment, target.queueId);
    }
    const binding = this.registry.register(entry, pending);
    if (!binding) {
      releasePolling(entry);
      return false;
    }
    // Queue items expire soon after starting. Check immediately on subscription.
    this.schedule(entry, pending || !("buildUrl" in target) ? 0 : undefined);
    this.applyBinding(binding);
    return true;
  }

  stopFollowingBuild(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    source: JenkinsBuildUrlSource = "reported"
  ): void {
    this.remove(this.registry.lookup(buildKey(environment, buildUrl, source)), "user-stop");
  }

  stopFollowingQueueItem(environment: JenkinsEnvironmentRef, queueId: number): void {
    const key = queueKey(environment, queueId);
    this.remove(this.registry.lookup(key), "user-stop");
  }

  pruneChangedControllers(): void {
    for (const entry of this.registry.active()) {
      this.stopIfControllerChanged(entry);
    }
  }

  private stopIfControllerChanged(entry: FollowEntry): boolean {
    if (this.actions.isCurrentController(entry.target.environment)) {
      return false;
    }
    this.remove(entry);
    void vscode.window.showInformationMessage(
      `Stopped following ${followLabel(entry.target)} because its Jenkins environment changed.`
    );
    return true;
  }

  async showFollowedBuilds(): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.registry.size === 0) {
      void vscode.window.showInformationMessage("No Jenkins builds are being followed.");
      return;
    }

    const selected = await this.pickWhileFollowing(
      () => ({
        placeholder: "Select a followed build",
        items: Array.from(this.registry.active(), (entry) => ({
          label: followLabel(entry.target),
          description: entry.target.environment.name ?? entry.target.environment.url,
          value: entry
        }))
      }),
      (entry) => this.registry.current(entry)
    );
    if (!selected) {
      return;
    }

    const action = await this.pickWhileFollowing(() => {
      const entry = this.registry.current(selected);
      const labels =
        "buildUrl" in entry.target
          ? [OPEN_BUILD_DETAILS_ACTION, STOP_FOLLOWING_ACTION]
          : [STOP_FOLLOWING_ACTION];
      return {
        placeholder: `Choose an action for ${followLabel(entry.target)}`,
        items: this.registry.isActive(entry) ? labels.map((label) => ({ label, value: label })) : []
      };
    });
    const current = this.registry.current(selected);
    if (!action || !this.canUseEntry(current)) {
      return;
    }
    if (action === STOP_FOLLOWING_ACTION) {
      this.remove(current, "user-stop");
    } else if ("buildUrl" in current.target) {
      const build = current.target;
      const endpoint = this.actionEndpoint(
        build,
        current,
        () => this.registry.current(current).runQueueId
      );
      await this.withEndpointAction(endpoint, () =>
        this.openFollowedBuild(current, build, endpoint)
      );
    }
  }

  private async openFollowedBuild(
    current: FollowEntry,
    build: FollowedBuild,
    endpoint: EndpointConsumer
  ): Promise<void> {
    const startingQueueId = current.runQueueId;
    const earlierCompletions = snapshotCompletedQueueIds(current);
    const status = await this.readBuildStatus(build).catch(() => undefined);
    const owner = this.registry.current(current);
    const key = buildKey(build.environment, build.buildUrl);
    const subscribed = this.registry.lookup(key);
    if (this.disposed || (subscribed && subscribed !== owner)) return;
    if (subscribed ? !this.canUseEntry(owner) : !owner.completion) return;
    if (!this.actions.isCurrentController(build.environment)) return;
    const verified = this.verifyFollowedOpen(owner, build, endpoint, startingQueueId, status);
    if (!verified) {
      void vscode.window.showWarningMessage(
        `Unable to open ${build.label}: Jenkins could not confirm the followed build at its numbered URL.`
      );
      return;
    }
    if (subscribed) {
      this.applyFollowedStatus(owner, build, verified.status, earlierCompletions);
      const after = this.registry.current(owner);
      const incumbent = this.registry.lookup(key);
      // The verified result can complete and remove this follow before opening the panel.
      if (
        this.disposed ||
        (incumbent ? incumbent !== after : !after.completion) ||
        !this.actions.isCurrentController(build.environment)
      )
        return;
    }
    if (endpoint.statusConflictOrder !== undefined) {
      void vscode.window.showWarningMessage(
        `Unable to open ${build.label}: Jenkins reported another run at its numbered URL.`
      );
      return;
    }
    await this.runAction("Unable to open build details", () =>
      this.actions.showBuildDetails(buildActionTarget(build, verified.status, verified.expected))
    );
  }

  private verifyFollowedOpen(
    owner: FollowEntry,
    build: FollowedBuild,
    endpoint: EndpointConsumer,
    startingQueueId: number | undefined,
    status: RunStatus | undefined
  ) {
    const observed = observedRunId(owner, build);
    const expected =
      owner.runQueueId ??
      owner.completion?.queueId ??
      observed ??
      owner.observedPanelIdentity?.queueId;
    if (
      !status ||
      !this.registry.matchesRun(owner, status.number, status.queueId) ||
      staleRunStatus(owner, build.buildNumber, startingQueueId, status) ||
      (endpoint.statusConflictOrder !== undefined &&
        !isExactTerminal(owner, build.buildNumber, status)) ||
      !this.matchesFollowedOpenIdentity(owner, endpoint, status, observed, expected)
    )
      return undefined;
    return { status, expected };
  }

  private matchesFollowedOpenIdentity(
    owner: FollowEntry,
    endpoint: EndpointConsumer,
    status: RunStatus,
    observed: number | undefined,
    expected: number | undefined
  ): boolean {
    if (isBuildQueueId(status.queueId))
      return (
        (expected === undefined && owner.completion === undefined) || status.queueId === expected
      );
    if (observed !== undefined || endpoint.requireQueueId) return false;
    return (
      !owner.completion || (status.building === false && status.result === owner.completion.result)
    );
  }

  private pickWhileFollowing<T>(
    getOptions: () => { placeholder: string; items: FollowPickerItem<T>[] },
    currentValue: (value: T) => T = (value) => value
  ): Promise<T | undefined> {
    const initial = getOptions();
    if (initial.items.length === 0) {
      return Promise.resolve(undefined);
    }
    const picker = vscode.window.createQuickPick<FollowPickerItem<T>>();
    picker.placeholder = initial.placeholder;
    picker.items = initial.items;
    return new Promise((resolve) => {
      const change = this.onDidChange(() => {
        const { placeholder, items } = getOptions();
        if (items.length === 0) {
          picker.hide();
          return;
        }
        const active = picker.activeItems[0];
        picker.placeholder = placeholder;
        picker.items = items;
        const replacement =
          active && items.find((item) => item.value === currentValue(active.value));
        if (replacement) {
          picker.activeItems = [replacement];
        }
      });
      const accept = picker.onDidAccept(() => {
        resolve(picker.selectedItems[0]?.value);
        picker.hide();
      });
      const hide = picker.onDidHide(() => {
        change.dispose();
        accept.dispose();
        hide.dispose();
        picker.dispose();
        resolve(undefined);
      });
      picker.show();
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const entry of this.registry.releaseAll()) {
      entry.deferredCompletion?.resolvePanelClaim?.(alreadyHandled);
      releasePolling(entry);
    }
    this.openEndpointActions.clear();
    this.queueCancellations.clear();
    for (const submissions of this.queueSubmissions.values()) {
      for (const observer of [...submissions.observers.keys()]) observer.finish();
      submissions.settle();
    }
    this.queueSubmissions.clear();
    this.statusBarItem?.dispose();
    this.changes.fire();
    this.changes.dispose();
    this.userStops.dispose();
    this.completions.dispose();
  }

  private schedule(entry: FollowEntry, delay = entry.backoff.next()): void {
    clearEntryTimer(entry);
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.poll(entry);
    }, delay);
  }

  private canUseEntry(entry: FollowEntry): boolean {
    return this.registry.isActive(entry) && !this.stopIfControllerChanged(entry);
  }

  private poll(entry: FollowEntry, locatedBuild?: QueueExecutable): Promise<void> {
    if (!this.canUseEntry(entry)) return Promise.resolve();
    const { target } = entry;
    return "buildUrl" in target
      ? this.pollRun(entry, target)
      : this.pollQueue(entry, target, locatedBuild);
  }

  private async pollQueue(
    entry: FollowEntry,
    target: FollowedQueueItem,
    locatedBuild?: QueueExecutable
  ): Promise<void> {
    const read = startQueueRead();
    entry.queueRead = read;
    try {
      const known = entry.queueExecutable ?? entry.disputedBuild?.build ?? locatedBuild;
      if (known) {
        await this.acceptQueueExecutable(entry, target, known, read);
        return;
      }
      const { item, outcome } = await this.readQueueObservation(target, read, entry);
      const executable =
        outcome?.kind === "started"
          ? outcome.build
          : outcome?.kind === "cancelled"
            ? undefined
            : read.locatedBuild;
      if (executable) {
        await this.acceptQueueExecutable(entry, target, executable, read);
        return;
      }
      if (!this.canUseEntry(entry) || entry.deferredCompletion) return;
      if (outcome) {
        this.endQueuePoll(entry, target, outcome);
        return;
      }
      this.updateQueueTask(entry, target, item);
      entry.consecutiveErrors = 0;
      this.schedule(entry);
    } catch (error) {
      if (this.canUseEntry(entry)) this.handleUnverifiedPoll(entry, error);
    } finally {
      this.settleQueueRead(entry, read);
    }
  }

  private updateQueueTask(
    entry: FollowEntry,
    target: FollowedQueueItem,
    item?: JenkinsQueueItem
  ): void {
    const taskUrl = item?.task?.url;
    if (!taskUrl || taskUrl === target.taskUrl) return;
    // A later number-only response can use the task URL from this same queue item.
    entry.target = describeQueueTask({ ...target, taskUrl });
    if (entry.target.label !== target.label) this.publish();
  }

  private endQueuePoll(
    entry: FollowEntry,
    target: FollowedQueueItem,
    outcome: NonNullable<QueueObservation>
  ): void {
    if (outcome.kind === "cancelled") {
      this.cancelQueueFollow(entry, target);
      return;
    }
    this.remove(entry);
    void vscode.window.showWarningMessage(
      `Stopped following ${followLabel(target)}: Jenkins did not identify the build.`
    );
  }

  private settleQueueRead(entry: FollowEntry, read: QueueIdentityRead): void {
    const owner = this.registry.current(entry);
    if (owner.queueRead === read) owner.queueRead = undefined;
    const waiters = read.waiters;
    read.waiters = undefined;
    read.priorResults = undefined;
    for (const waiting of waiters ?? []) this.resumeDeferredCompletion(waiting);
    read.provideExecutable = undefined;
    read.settle();
  }

  private async pollRun(entry: FollowEntry, advertised: FollowedBuild): Promise<void> {
    let target = advertised;
    const startingQueueId = entry.runQueueId;
    let statusRequest: Promise<RunStatus> | undefined;
    let statusRequestOrder: number | undefined;
    try {
      const earlierCompletions = snapshotCompletedQueueIds(entry);
      statusRequestOrder = nextBuildObservationOrder();
      const evidence = entry.queueEvidence;
      const replacement = verifiedQueueAlternate(evidence, advertised);
      statusRequest = this.requestPolledStatus(
        advertised,
        statusRequestOrder,
        evidence,
        replacement
      );
      entry.statusRequest = statusRequest;
      const observed = evidence
        ? await this.readAssignedRun(entry, advertised, statusRequest, evidence, replacement)
        : { target, details: await statusRequest };
      if (!observed) return;
      target = observed.target;
      const { details } = observed;
      if (entry.statusRequest !== statusRequest || !this.canUseEntry(entry)) return;
      const conflict = this.settleStatusConflict(entry, details, statusRequest);
      if (conflict) await conflict;
      if (conflict && !this.isCurrentPollRead(entry, statusRequest)) return;
      this.applyPolledRun(entry, target, details, startingQueueId, earlierCompletions);
    } catch (error) {
      if (this.hasCompetingPollRead(entry, statusRequest)) {
        const observations = await this.pendingStatusResults(entry);
        if (
          !this.isCurrentPollRead(entry, statusRequest) ||
          this.recoverPolledStatus(entry, target, observations)
        )
          return;
      }
      this.handleRunPollFailure(entry, error, startingQueueId, statusRequest, statusRequestOrder);
    } finally {
      if (entry.statusRequest === statusRequest) {
        entry.statusRequest = undefined;
        this.resumeDeferredCompletion(entry);
      }
    }
  }

  private hasCompetingPollRead(
    entry: FollowEntry,
    statusRequest: Promise<RunStatus> | undefined
  ): statusRequest is Promise<RunStatus> {
    return Boolean(
      entry.competingStatuses?.size &&
        statusRequest &&
        entry.statusRequest === statusRequest &&
        this.canUseEntry(entry)
    );
  }

  private isCurrentPollRead(entry: FollowEntry, request: Promise<RunStatus>): boolean {
    return this.canUseEntry(entry) && entry.statusRequest === request;
  }

  private requestPolledStatus(
    advertised: FollowedBuild,
    order: number,
    evidence?: QueueItemEvidence,
    replacement?: QueueExecutable
  ): Promise<RunStatus> {
    // Both the locator and the follow can share the first read of this literal URL.
    if (replacement?.queueStatus) return Promise.resolve(replacement.queueStatus);
    const request = () => this.requestBuildStatus(advertised, order);
    return evidence?.readAdvertised(advertised, request) ?? request();
  }

  private applyPolledRun(
    entry: FollowEntry,
    target: FollowedBuild,
    details: RunStatus,
    startingQueueId: number | undefined,
    earlierCompletions?: number[]
  ): void {
    if (staleRunStatus(entry, target.buildNumber, startingQueueId, details)) {
      if (!entry.deferredCompletion) this.schedule(entry);
      return;
    }
    if (!this.verifyRunAtUrl(entry.key, entry, details.number, details.queueId)) return;
    if (this.applyFollowedStatus(entry, target, details, earlierCompletions) !== entry) return;
    entry.consecutiveErrors = 0;
    this.schedule(entry);
  }

  private recoverPolledStatus(
    entry: FollowEntry,
    target: FollowedBuild,
    observations: Array<RunStatus | undefined>
  ): boolean {
    const exact = observations.find(
      (status) => status && isExactTerminal(entry, target.buildNumber, status)
    );
    if (exact) {
      this.applyFollowedStatus(entry, target, exact);
      return true;
    }
    const identified = observations.some(
      (other) =>
        other &&
        other.number === target.buildNumber &&
        (entry.runQueueId === undefined || other.queueId === entry.runQueueId) &&
        typeof other.building === "boolean"
    );
    if (identified && !entry.deferredCompletion) this.schedule(entry);
    return identified;
  }

  private handleRunPollFailure(
    entry: FollowEntry,
    error: unknown,
    startingQueueId: number | undefined,
    request?: Promise<RunStatus>,
    order?: number
  ): void {
    if ((request && entry.statusRequest !== request) || !this.canUseEntry(entry)) return;
    // A newer executable confirmation may already have bound this URL to a run.
    if (
      startingQueueId !== entry.runQueueId ||
      (entry.runQueueId !== undefined && order !== undefined && order < latestIdentityOrder(entry))
    ) {
      if (!entry.deferredCompletion) this.schedule(entry);
      return;
    }
    const terminalOrder = entry.deferredCompletion?.statusRequestOrder;
    if (terminalOrder !== undefined && order !== undefined && order < terminalOrder) return;
    this.handleUnverifiedPoll(entry, error);
  }

  private handleUnverifiedPoll(entry: FollowEntry, error: unknown): void {
    const terminal = entry.deferredCompletion;
    if (
      "buildUrl" in entry.target &&
      terminal &&
      (terminal.resolvePanelClaim || entry.runQueueId !== undefined)
    ) {
      this.releaseDeferredObservation(
        entry,
        this.unverifiedPanelDelivery(entry, terminal.build, terminal.result)
      );
    }
    if (!entry.deferredCompletion) this.handlePollError(entry, error);
  }

  /** A submitted job can identify a second endpoint after this first Run request is already in flight. */
  private async readAssignedRun(
    entry: FollowEntry,
    advertised: FollowedBuild,
    statusRequest: Promise<RunStatus>,
    evidence: QueueItemEvidence,
    replacement?: QueueExecutable
  ): Promise<{ target: FollowedBuild; details: RunStatus } | undefined> {
    let selected = replacement;
    let details: RunStatus;
    try {
      details = await statusRequest;
    } catch (error) {
      const alternate = evidence.alternateFor(advertised);
      if (!alternate || !isNotFoundError(error) || !this.canUseEntry(entry)) throw error;
      selected = await evidence.selectExecutable(
        alternate,
        (candidate) =>
          candidate.buildUrl === advertised.buildUrl
            ? Promise.reject(error)
            : this.readBuildStatus(candidate, entry.runQueueId),
        () => this.canUseEntry(entry) && entry.target === advertised
      );
      if (!selected?.queueStatus) throw error;
      details = selected.queueStatus;
    }
    if (selected && selected.buildUrl !== advertised.buildUrl) {
      if (
        entry.statusRequest !== statusRequest ||
        !this.canUseEntry(entry) ||
        details.queueId !== entry.runQueueId ||
        !isBuildQueueId(details.queueId)
      )
        return;
      const target = { ...advertised, buildUrl: selected.buildUrl };
      return this.promoteAssignedRun(entry, target, details, details.queueId, statusRequest);
    }
    evidence.confirmAdvertised(advertised, details);
    return { target: advertised, details };
  }

  private async promoteAssignedRun(
    entry: FollowEntry,
    target: FollowedBuild,
    initialDetails: RunStatus,
    id: number,
    statusRequest: Promise<RunStatus>
  ): Promise<{ target: FollowedBuild; details: RunStatus } | undefined> {
    let details = initialDetails;
    const key = buildKey(target.environment, target.buildUrl);
    const incumbent = this.registry.lookup(key);
    if (incumbent && incumbent !== entry) {
      if (details.building === false) {
        await this.claimPanelCompletion({
          notice: {
            ...target,
            queueId: id,
            result: details.result,
            requestOrder: details.requestOrder
          },
          subscribersOnly: true
        });
        return;
      }
      // Another follow can acquire this URL while the alternate is being checked.
      const checked = await this.confirmQueueExecutable(entry, target, id, incumbent);
      const verified = this.acceptAlternateVerification(entry, target, id, checked, statusRequest);
      if (!verified) return;
      details = verified;
    }
    const binding = this.registry.replaceMissingEndpoint(entry, target, id);
    if (!binding) throw new Error("The submitted build changed while confirming its queue item.");
    this.applyBinding(binding);
    return { target, details };
  }

  private acceptAlternateVerification(
    entry: FollowEntry,
    target: FollowedBuild,
    id: number,
    current: RunStatus | undefined,
    statusRequest: Promise<RunStatus>
  ): RunStatus | undefined {
    if (entry.statusRequest !== statusRequest || !this.canUseEntry(entry)) return;
    if (!current || current.queueId !== id)
      throw new Error("Jenkins could not confirm the queue item at the submitted job.");
    const owner = this.registry.lookup(buildKey(target.environment, target.buildUrl));
    this.bindUnidentifiedAlternate(entry, owner, target, id);
    return current;
  }

  private bindUnidentifiedAlternate(
    entry: FollowEntry,
    owner: FollowEntry | undefined,
    target: FollowedBuild,
    id: number
  ): void {
    if (owner && owner !== entry && owner.runQueueId === undefined)
      this.bindRunQueue(owner, target, id);
  }

  private async withEndpointAction<T>(
    consumer: EndpointConsumer,
    action: () => Promise<T>
  ): Promise<T> {
    const interest = { consumer };
    this.openEndpointActions.add(interest);
    try {
      return await action();
    } finally {
      this.openEndpointActions.delete(interest);
    }
  }

  private observeEndpointIdentity(
    environment: JenkinsEnvironmentRef,
    requestUrl: string,
    number: number,
    queueId?: number,
    requestOrder?: number,
    building?: boolean
  ): void {
    if (this.disposed) return;
    const literal = normalizeJenkinsUrlForComparison(requestUrl, environment.url);
    const key = buildKey(environment, requestUrl);
    if (requestOrder !== undefined) {
      const change = this.registry.observeLiteralEndpoint(
        environment,
        literal,
        number,
        queueId,
        requestOrder
      );
      if (change.detached) this.publish();
      if (change.restored) this.applyBinding(change.restored);
    }
    const consumers = new Set<EndpointConsumer>();
    const active = this.registry.lookup(key);
    if (active) consumers.add(active);
    for (const { consumer } of this.openEndpointActions) consumers.add(consumer);
    for (const consumer of consumers) {
      const { target } = consumer;
      if (
        !("buildUrl" in target) ||
        !sameController(environment, target.environment) ||
        literal !== normalizeJenkinsUrlForComparison(target.buildUrl, environment.url)
      )
        continue;
      this.applyEndpointObservation(consumer, active, target, {
        requestUrl,
        number,
        queueId,
        requestOrder,
        building
      });
    }
  }

  private applyEndpointObservation(
    consumer: EndpointConsumer,
    active: FollowEntry | undefined,
    target: FollowedBuild,
    {
      requestUrl,
      number,
      queueId,
      requestOrder,
      building
    }: {
      requestUrl: string;
      number: number;
      queueId: number | undefined;
      requestOrder: number | undefined;
      building: boolean | undefined;
    }
  ): void {
    const id = consumer.runQueueId;
    // Even an older response proves that this literal endpoint can identify this exact run.
    if (target.buildNumber === number && isBuildQueueId(id) && queueId === id) {
      consumer.requireQueueId = true;
      if (consumer === active) rememberRunEndpoint(active, requestUrl, id, requestOrder);
    }
    if (requestOrder === undefined || requestOrder < latestIdentityOrder(consumer)) return;
    if (
      target.buildNumber === number &&
      (isBuildQueueId(queueId) ||
        (building === true && requestStartedAfterNotice(requestOrder, consumer.completionOrder)))
    ) {
      consumer.requireQueueId = true;
    }
    this.reconcileEndpointConflict(consumer, target.buildNumber, number, queueId, requestOrder);
  }

  private reconcileEndpointConflict(
    consumer: EndpointConsumer,
    expectedNumber: number,
    reportedNumber: number,
    queueId: number | undefined,
    requestOrder: number
  ): void {
    const id = consumer.runQueueId;
    if (
      expectedNumber !== reportedNumber ||
      (isBuildQueueId(queueId) && id !== undefined && queueId !== id)
    ) {
      consumer.latestIdentityOrder = requestOrder;
      consumer.statusConflictOrder = nextBuildObservationOrder();
    } else if (
      (consumer.statusConflictOrder !== undefined || id !== undefined) &&
      requestOrder > (consumer.statusConflictOrder ?? 0) &&
      isBuildQueueId(queueId) &&
      (id === undefined || queueId === id)
    ) {
      consumer.latestIdentityOrder = requestOrder;
      consumer.statusConflictOrder = undefined;
    }
  }

  /** Before releasing a reused numbered URL, let outstanding reads claim the old run's exact result. */
  private settleStatusConflict(
    entry: FollowEntry,
    status: Pick<RunStatus, "number" | "queueId" | "requestOrder">,
    ownRequest?: Promise<RunStatus>
  ): Promise<void> | undefined {
    if (
      entry.runQueueId === undefined ||
      !("buildUrl" in entry.target) ||
      status.requestOrder < latestIdentityOrder(entry) ||
      this.registry.matchesRun(entry, status.number, status.queueId)
    )
      return undefined;
    const ordinary = entry.statusRequest !== ownRequest ? entry.statusRequest : undefined;
    if (!ordinary && !entry.competingStatuses?.size) return undefined;
    const target = entry.target;
    return Promise.all([this.pendingStatusResults(entry), ordinary?.catch(() => undefined)]).then(
      ([actions, poll]) => {
        if (!this.canUseEntry(entry)) return;
        const exact = [...actions, poll].find(
          (result) => result && isExactTerminal(entry, target.buildNumber, result)
        );
        if (exact) this.applyFollowedStatus(entry, target, exact);
      }
    );
  }

  private pendingStatusResults(entry: FollowEntry): Promise<Array<RunStatus | undefined>> {
    return Promise.all(
      Array.from(entry.competingStatuses ?? [], async ([request, expectedId]) => {
        const status = await request.catch(() => undefined);
        if (!status || expectedId === undefined || status.queueId === expectedId) return status;
        return "buildUrl" in entry.target &&
          isExactTerminal(entry, entry.target.buildNumber, status)
          ? status
          : undefined;
      })
    );
  }

  /** Every independent Run verification can settle an overlapping poll before it releases its owner. */
  private readBuildStatus(target: FollowedBuild, requiredQueueId?: number): Promise<RunStatus> {
    const entry = this.registry.lookup(buildKey(target.environment, target.buildUrl));
    const status = this.requestBuildStatus(target);
    if (!entry) return status;
    entry.competingStatuses ??= new Map();
    entry.competingStatuses.set(status, requiredQueueId);
    return status.finally(() => {
      entry.competingStatuses?.delete(status);
      if (!entry.competingStatuses?.size) entry.competingStatuses = undefined;
    });
  }

  private applyFollowedStatus(
    entry: FollowEntry,
    target: FollowedBuild,
    details: RunStatus,
    earlierCompletions?: number[]
  ): FollowEntry | undefined {
    if (
      entry.statusConflictOrder !== undefined &&
      !isExactTerminal(entry, target.buildNumber, details)
    )
      return entry;
    rememberRunStatus(entry, target.buildUrl, details);
    if (!this.reconcileTerminalStatus(entry, details) || entry.deferredCompletion) return undefined;
    const owner = this.bindStatusIdentity(entry, target, details, earlierCompletions);
    if (!owner) return undefined;
    if (details.building === false) {
      this.finishFollow(
        target,
        details.result,
        owner.runQueueId,
        "requested",
        owner,
        details.requestOrder
      );
      return undefined;
    }
    return owner;
  }

  private bindStatusIdentity(
    entry: FollowEntry,
    target: FollowedBuild,
    details: RunStatus,
    earlierCompletions?: number[]
  ): FollowEntry | undefined {
    let owner = entry;
    if (isBuildQueueId(details.queueId)) {
      if (this.alreadyAnnounced(entry, details.queueId, details)) {
        this.finishFollow(
          target,
          details.result,
          details.queueId,
          "previously-notified",
          entry,
          details.building === false ? details.requestOrder : undefined
        );
        return undefined;
      }
      entry.completedQueues = undefined;
      owner = this.bindRunQueue(entry, target, details.queueId);
      if (!this.registry.isActive(owner)) return undefined;
    } else if (details.building && earlierCompletions) {
      // A fresh running observation cannot be a result announced before this request.
      // Keep candidates while their queue response can still verify the executable URL.
      for (const id of earlierCompletions) {
        if (!entry.completedQueues?.get(id)?.read?.waiters) entry.completedQueues?.delete(id);
      }
    }
    return owner;
  }

  private readQueueObservation(
    queue: FollowedQueueItem,
    read: QueueIdentityRead,
    entry: FollowEntry
  ): Promise<{ item?: JenkinsQueueItem; outcome: QueueObservation }> {
    const discovered = new Promise<{ outcome: { kind: "started"; build: QueueExecutable } }>(
      (resolve) => {
        read.provideExecutable = (build) => resolve({ outcome: { kind: "started", build } });
      }
    );
    const key = queueKey(queue.environment, queue.queueId);
    const requested = this.dataService.getQueueItem(queue.environment, queue.queueId).then(
      async (item) => {
        const submissions = this.queueSubmissions.get(key);
        const outcome = this.canUseEntry(entry)
          ? entry.queueEvidence?.observe(item)
          : resolveFollowedQueueItem(queue, item, entry.queueEvidence?.submittedJobUrl);
        if (outcome) entry.queueObservationEnd?.settle();
        // A matching submission can still identify an executable that this read missed.
        if (outcome?.kind === "unknown" && submissions) await submissions.settled;
        return { item, outcome };
      },
      async (error: unknown) => {
        if (
          isTerminalClientError(error) ||
          entry.consecutiveErrors + 1 >= this.maxConsecutiveErrors
        ) {
          entry.queueObservationEnd?.settle();
          const submissions = this.queueSubmissions.get(key);
          if (submissions) await submissions.settled;
        }
        throw error;
      }
    );
    return Promise.race([discovered, requested]);
  }

  /** Resolve a provisional result only against a status observation, never a queue ID alone. */
  private reconcileTerminalStatus(
    entry: FollowEntry,
    details: JenkinsBuildDetails & { requestOrder?: number },
    priorResult?: PriorResult
  ): boolean {
    const terminal = entry.deferredCompletion;
    if (!terminal) return true;
    if (this.waitForCurrentTerminalRead(entry, terminal, details)) return false;
    const needsVerification =
      terminal.verifyAfterOrder !== undefined || entry.runQueueId !== undefined;
    terminal.verifyAfterOrder = undefined;
    if (typeof details.building !== "boolean") {
      if (needsVerification) {
        this.releaseDeferredObservation(
          entry,
          this.unverifiedPanelDelivery(entry, terminal.build, terminal.result)
        );
      }
      return true;
    }
    const id = isBuildQueueId(details.queueId) ? details.queueId : entry.runQueueId;
    const same =
      !details.building &&
      buildResultsCompatible(terminal.result, details.result) &&
      (terminal.queueId === undefined || id === undefined || terminal.queueId === id);
    // Two terminal observations without a queue ID may still need an outstanding
    // queue response to establish whether another subscription already announced them.
    if (same && id === undefined) {
      extendTerminalReadOrder(terminal, details.requestOrder);
      return true;
    }
    const decision = this.terminalReadDecision(entry, terminal, details, id, same, priorResult);
    this.releaseDeferredObservation(entry, decision);
    if (
      details.building &&
      !entry.statusRequest &&
      entry.timer === undefined &&
      "buildUrl" in entry.target &&
      this.registry.isActive(entry)
    )
      this.schedule(entry);
    return true;
  }

  private terminalReadDecision(
    entry: FollowEntry,
    terminal: TerminalObservation,
    details: JenkinsBuildDetails,
    id: number | undefined,
    same: boolean,
    priorResult?: PriorResult
  ): PanelCompletionDecision {
    let decision: PanelCompletionDecision = panelDelivery;
    if (
      this.alreadyAnnounced(entry, id, terminal) ||
      (same &&
        priorResult &&
        buildResultsCompatible(priorResult.result, terminal.result) &&
        buildResultsCompatible(priorResult.result, details.result))
    )
      decision = alreadyHandled;
    else if (same) decision = trackerDelivery;
    else if (details.building && isBuildQueueId(details.queueId))
      decision = { disposition: "panel", verifiedRunningQueueId: details.queueId };
    return decision;
  }

  private waitForCurrentTerminalRead(
    entry: FollowEntry,
    terminal: TerminalObservation,
    details: JenkinsBuildDetails & { requestOrder?: number }
  ): boolean {
    if (
      terminal.statusRequestOrder !== undefined &&
      details.requestOrder !== undefined &&
      details.requestOrder < terminal.statusRequestOrder &&
      (details.building !== false || !isBuildQueueId(details.queueId))
    ) {
      // A later Run read already saw completion. An older running/anonymous response can't overturn it.
      return true;
    }
    const cutoff = Math.max(terminal.verifyAfterOrder ?? 0, terminal.build.requestOrder ?? 0);
    if (
      details.requestOrder !== undefined &&
      !requestStartedAfterNotice(details.requestOrder, cutoff) &&
      (details.building === true || terminal.verifyAfterOrder !== undefined)
    ) {
      terminal.verifyAfterOrder = cutoff;
      this.resumeDeferredCompletion(entry);
      return true;
    }
    return false;
  }

  private releaseDeferredObservation(entry: FollowEntry, decision: PanelCompletionDecision): void {
    const terminal = entry.deferredCompletion;
    entry.deferredCompletion = undefined;
    if (!terminal) return;
    const previouslyAnnounced =
      matchesPreviousCompletion(terminal.previousCompletion, terminal.result, terminal.queueId) ||
      Boolean(matchingNumberedNotice(entry, terminal.result, terminal.queueId));
    if (terminal.previouslyDelivered || previouslyAnnounced) {
      resolvePanelClaim(terminal, alreadyHandled);
      return;
    }
    if (
      decision.disposition === "panel" &&
      (!terminal.resolvePanelClaim || terminal.queueId !== undefined)
    ) {
      // A positively identified queued result remains owned by the follow even if its URL changed.
      const noticeOrder = nextBuildObservationOrder();
      this.publishCompletionIdentity(
        terminal.build,
        terminal.queueId,
        terminal.result,
        [],
        terminal.build.buildUrl,
        noticeOrder
      );
      this.notifyCompletion(
        terminal.build,
        terminal.result,
        terminal.action.queueId,
        terminal.action.requireQueueId,
        entry
      );
      this.commitUnverifiedResult(decision, terminal.result, noticeOrder);
      resolvePanelClaim(terminal, trackerDelivery);
    } else {
      resolvePanelClaim(terminal, decision);
    }
  }

  private resumeDeferredCompletion(entry: FollowEntry): void {
    const terminal = entry.deferredCompletion;
    if (!terminal || !this.canUseEntry(entry)) return;
    if (
      terminal.verifyAfterOrder !== undefined ||
      (terminal.queueId === undefined && entry.runQueueId !== undefined)
    ) {
      if ("buildUrl" in entry.target && !entry.statusRequest && entry.timer === undefined)
        this.schedule(entry, 0);
      return;
    }
    this.finishFollow(
      terminal.build,
      terminal.result,
      terminal.queueId,
      terminal.previouslyDelivered ? "previously-notified" : "requested",
      entry,
      terminal.statusRequestOrder
    );
  }

  private async acceptQueueExecutable(
    entry: FollowEntry,
    target: FollowedQueueItem,
    executable: QueueExecutable,
    read: QueueIdentityRead | undefined
  ): Promise<void> {
    if (this.disposed || !read) return;
    let assignment: QueueAssignment = { build: executable };
    if (executable.fallbackUrl) {
      const selected = await this.selectAssignedExecutable(entry, target, executable);
      if (!selected) return;
      assignment = selected;
    }
    const owner = this.registry.current(entry);
    if (this.registry.isActive(owner)) {
      return this.adoptQueueExecutable(entry, owner, target.queueId, assignment, read);
    }
    return this.reconcileCompletedExecutable(owner, target, assignment.build, read);
  }

  private async selectAssignedExecutable(
    entry: FollowEntry,
    target: FollowedQueueItem,
    executable: QueueExecutable
  ): Promise<QueueAssignment | undefined> {
    const active = () => this.canUseEntry(this.registry.current(entry));
    if (!active()) return undefined;
    entry.queueExecutable = executable;
    let routeOwner: ReturnType<typeof observeIncumbent> | undefined;
    let selected: QueueExecutable | undefined;
    try {
      selected = await entry.queueEvidence?.selectExecutable(
        executable,
        (candidate) => {
          routeOwner = observeIncumbent(
            this.registry.lookup(buildKey(target.environment, candidate.buildUrl))
          );
          return this.readBuildStatus(candidate, target.queueId);
        },
        active
      );
    } catch (error) {
      if (active())
        this.retryQueueConfirmation(entry, formatActionError(error), isTerminalClientError(error));
      return undefined;
    }
    if (!active()) return undefined;
    if (!selected) {
      this.retryQueueConfirmation(
        entry,
        "Jenkins could not confirm the executable for this queue item.",
        true
      );
      return undefined;
    }
    entry.queueExecutable = undefined;
    return { build: selected, routeOwner };
  }

  private async adoptQueueExecutable(
    entry: FollowEntry,
    initialOwner: FollowEntry,
    id: number,
    { build, routeOwner }: QueueAssignment,
    read: QueueIdentityRead
  ): Promise<void> {
    let owner = initialOwner;
    if (!this.canUseEntry(owner)) return;
    const key = buildKey(build.environment, build.buildUrl);
    const previousResultAtUrl = () =>
      read.priorResults?.get(build.buildNumber)?.get(key) ?? entry.unverifiedResults?.get(key);
    let priorResult = previousResultAtUrl();
    if (entry.endedBuilds?.has(key)) {
      if (owner === entry) this.remove(entry);
      return;
    }
    // A terminal queue observation already identifies its run. The last read only
    // decides whether that result was announced at another numbered endpoint.
    if (owner === entry && entry.deferredCompletion && !priorResult) return;
    if (this.claimTerminalAssignment(owner, build, id, routeOwner)) return;
    const incumbent = this.registry.lookup(key);
    let confirmed = build.queueStatus;
    if (this.needsAssignmentConfirmation(entry, owner, key, id, priorResult, incumbent)) {
      const verification =
        routeOwner && confirmed ? { observed: routeOwner, status: confirmed } : undefined;
      confirmed = await this.confirmQueueExecutable(entry, build, id, incumbent, verification);
      if (!confirmed) return;
      const current = this.reconcileVerifiedAssignment(
        entry,
        build,
        id,
        incumbent,
        confirmed,
        previousResultAtUrl
      );
      if (!current) return;
      ({ owner, priorResult } = current);
    }
    this.applyQueueAssignment(entry, owner, build, id, key, incumbent, confirmed, priorResult);
  }

  private reconcileVerifiedAssignment(
    entry: FollowEntry,
    build: FollowedBuild,
    id: number,
    incumbent: FollowEntry | undefined,
    confirmed: RunStatus,
    previousResultAtUrl: () => PriorResult | undefined
  ) {
    const owner = this.registry.current(entry);
    if (!this.canUseEntry(owner)) return undefined;
    const priorResult = previousResultAtUrl();
    if (
      !this.reconcileTerminalStatus(owner, confirmed, priorResult) &&
      confirmed.building === false
    )
      return undefined;
    if (!this.canAdoptConfirmedAssignment(entry, owner, build, id, incumbent)) return undefined;
    return { owner, priorResult };
  }

  private claimTerminalAssignment(
    owner: FollowEntry,
    build: QueueExecutable,
    id: number,
    routeOwner: QueueAssignment["routeOwner"]
  ): boolean {
    const status = build.queueStatus;
    if (!status) return false;
    rememberRunStatus(owner, build.buildUrl, status);
    if (routeOwner || status.building !== false || status.queueId !== id) return false;
    void this.claimPanelCompletion({
      notice: { ...build, queueId: id, result: status.result, requestOrder: status.requestOrder },
      subscribersOnly: true
    });
    return true;
  }

  private needsAssignmentConfirmation(
    entry: FollowEntry,
    owner: FollowEntry,
    key: string,
    id: number,
    prior?: PriorResult,
    incumbent?: FollowEntry
  ): boolean {
    return Boolean(
      prior ||
        entry.disputedBuild ||
        this.registry.isRetired(owner, key) ||
        (incumbent && incumbent !== owner && incumbent.runQueueId !== id)
    );
  }

  private canAdoptConfirmedAssignment(
    entry: FollowEntry,
    owner: FollowEntry,
    build: FollowedBuild,
    id: number,
    incumbent: FollowEntry | undefined
  ): boolean {
    const current = this.registry.lookup(buildKey(build.environment, build.buildUrl));
    if (!current || current === owner) return true;
    if (
      this.registry.matchesRun(current, build.buildNumber, id) &&
      (current === incumbent || current.runQueueId === id)
    )
      return true;
    this.retryQueueConfirmation(
      entry,
      "the followed build changed while verifying the executable URL."
    );
    return false;
  }

  private applyQueueAssignment(
    entry: FollowEntry,
    owner: FollowEntry,
    build: QueueExecutable,
    id: number,
    key: string,
    incumbent: FollowEntry | undefined,
    confirmed: RunStatus | undefined,
    priorResult: PriorResult | undefined
  ): void {
    if (confirmed) entry.unverifiedResults?.delete(key);
    if (
      priorResult &&
      confirmed?.building === false &&
      buildResultsCompatible(priorResult.result, confirmed.result)
    ) {
      if (!this.releaseAnnouncedAssignment(owner, build, id, key, confirmed, priorResult)) return;
    } else if (owner === entry) {
      this.handoff(entry, build);
      // The initial checked read already observed the run. Resume on the normal backoff.
      const started = this.registry.lookup(key);
      if (!incumbent && confirmed?.building && started && this.registry.isActive(started))
        this.schedule(started);
    } else if (this.registry.lookup(entry.key) === owner) {
      this.attachExecutableAlias(owner, build, id);
    }
    if (confirmed?.building === false && this.registry.lookup(key)?.runQueueId === id)
      this.finishFollow(
        build,
        confirmed.result,
        id,
        "requested",
        undefined,
        confirmed.requestOrder
      );
  }

  private releaseAnnouncedAssignment(
    owner: FollowEntry,
    build: FollowedBuild,
    id: number,
    key: string,
    status: RunStatus,
    priorResult: PriorResult
  ): boolean {
    if ("buildUrl" in owner.target && !this.verifyRunAtUrl(key, owner, build.buildNumber, id))
      return false;
    this.publishCompletionIdentity(
      build,
      id,
      status.result ?? priorResult.result,
      [owner],
      build.buildUrl,
      priorResult.noticeOrder
    );
    this.remove(owner);
    return true;
  }

  private async reconcileCompletedExecutable(
    owner: FollowEntry,
    target: FollowedQueueItem,
    build: QueueExecutable,
    read: QueueIdentityRead
  ): Promise<void> {
    // An executable may finish while the queue read identifies one of its alternate URLs.
    const id = target.queueId;
    const completion = owner.completion;
    if (
      completion?.queueId !== id ||
      completion.buildNumber !== build.buildNumber ||
      !this.actions.isCurrentController(target.environment)
    )
      return;
    const alternate = this.findWaitingAlternate(build, id, read);
    if (!alternate) {
      this.emitCompletion({
        ...build,
        queueId: id,
        result: completion.result,
        noticeOrder: completion.noticeOrder
      });
      return;
    }
    if (alternate.runQueueId === undefined) {
      const details = await this.readBuildStatus(build).catch(() => undefined);
      if (!this.confirmCompletedAlternate(alternate, build, id, details)) return;
    }
    this.publishCompletionIdentity(
      build,
      id,
      completion.result,
      [alternate],
      build.buildUrl,
      completion.noticeOrder
    );
    this.remove(alternate);
  }

  private findWaitingAlternate(build: FollowedBuild, id: number, read: QueueIdentityRead) {
    const alternate = this.registry.lookup(buildKey(build.environment, build.buildUrl));
    if (
      !alternate ||
      !("buildUrl" in alternate.target) ||
      alternate.target.buildNumber !== build.buildNumber ||
      (alternate.runQueueId !== undefined && alternate.runQueueId !== id) ||
      alternate.completedQueues?.get(id)?.read !== read
    )
      return undefined;
    return alternate;
  }

  private confirmCompletedAlternate(
    alternate: FollowEntry,
    build: FollowedBuild,
    id: number,
    details: RunStatus | undefined
  ): boolean {
    if (
      !this.canUseEntry(alternate) ||
      !details ||
      details.number !== build.buildNumber ||
      !isBuildQueueId(details.queueId)
    )
      return false;
    if (alternate.runQueueId !== undefined && alternate.runQueueId !== details.queueId)
      return false;
    if (!this.reconcileTerminalStatus(alternate, details)) return false;
    if (
      details.queueId !== id ||
      (details.building === false && !this.alreadyAnnounced(alternate, id, details))
    ) {
      this.confirmUnidentifiedRun(alternate, details, build);
      return false;
    }
    return true;
  }

  private requestBuildStatus(
    build: FollowedBuild,
    requestOrder = nextBuildObservationOrder()
  ): Promise<RunStatus> {
    const owner = this.registry.lookup(buildKey(build.environment, build.buildUrl));
    return this.dataService
      .getBuildDetails(build.environment, build.buildUrl, {
        statusOnly: true,
        bypassCache: true
      })
      .then((details) => {
        if (
          details.number === build.buildNumber &&
          (!owner || this.registry.isActive(this.registry.current(owner)))
        )
          this.observeSubmittedExecutable(build, details.queueId, requestOrder);
        this.observeEndpointIdentity(
          build.environment,
          build.buildUrl,
          details.number,
          details.queueId,
          requestOrder,
          details.building
        );
        return { ...details, requestOrder };
      });
  }

  private confirmUnidentifiedRun(
    entry: FollowEntry,
    details: RunStatus,
    observed: FollowedBuild
  ): void {
    const build = entry.target;
    const id = details.queueId;
    if (
      entry.runQueueId !== undefined ||
      !("buildUrl" in build) ||
      !isBuildQueueId(id) ||
      details.number !== build.buildNumber
    )
      return;
    rememberRunStatus(entry, observed.buildUrl, details);
    if (!this.reconcileTerminalStatus(entry, details)) return;
    const announced = this.alreadyAnnounced(entry, id, details);
    const owner = this.bindRunQueue(entry, build, id);
    if (this.canUseEntry(owner) && (announced || details.building === false))
      this.finishFollow(
        build,
        details.result,
        id,
        announced ? "previously-notified" : "requested",
        owner,
        details.building === false ? details.requestOrder : undefined
      );
  }

  /** A queue response identifies the run originally assigned, but its URL may since have been reused. */
  private async confirmQueueExecutable(
    entry: FollowEntry,
    build: FollowedBuild,
    id: number,
    incumbent: FollowEntry | undefined,
    verification?: { observed: ReturnType<typeof observeIncumbent>; status: RunStatus }
  ): Promise<RunStatus | undefined> {
    const dispute = entry.disputedBuild ?? { build };
    if (incumbent && !this.registry.identifiesDifferentQueue(dispute.incumbent, id))
      dispute.incumbent = incumbent;
    if (this.registry.isActive(entry)) entry.disputedBuild = dispute;
    const observed = verification?.observed ?? observeIncumbent(incumbent);
    let details: RunStatus;
    try {
      // The URL could still have belonged to a different run before Jenkins assigned it.
      details = verification?.status ?? (await this.readBuildStatus(build, id));
    } catch (error) {
      this.retryQueueConfirmation(entry, formatActionError(error), isTerminalClientError(error));
      return undefined;
    }
    if (
      incumbent &&
      this.canUseEntry(incumbent) &&
      this.canUseEntry(this.registry.current(entry))
    ) {
      const conflict = this.settleStatusConflict(incumbent, details);
      if (conflict) await conflict;
    }
    await this.waitForNumberedStatusConflict(entry, observed, build, details);
    return this.applyQueueConfirmation(entry, build, id, observed, dispute, details);
  }

  private applyQueueConfirmation(
    entry: FollowEntry,
    build: FollowedBuild,
    id: number,
    observed: ReturnType<typeof observeIncumbent>,
    dispute: NonNullable<FollowEntry["disputedBuild"]>,
    details: RunStatus
  ): RunStatus | undefined {
    const owner = this.registry.current(entry);
    if (!this.canUseEntry(owner)) return undefined;
    const key = buildKey(build.environment, build.buildUrl);
    if (entry.endedBuilds?.has(key)) {
      if (owner === entry) this.remove(entry);
      return undefined;
    }
    const current = this.registry.lookup(key);
    if (
      (current && supersededStatus(current, build.buildNumber, details)) ||
      ownershipChangedDuringRead(observed, current, owner, build, id, details)
    ) {
      this.retryQueueConfirmation(
        entry,
        "the followed build changed while verifying the executable URL."
      );
      return undefined;
    }
    if (
      details.number !== build.buildNumber ||
      (isBuildQueueId(details.queueId) && details.queueId !== id)
    ) {
      if (current) this.confirmUnidentifiedRun(current, details, build);
      this.retryQueueConfirmation(
        entry,
        "Jenkins returned a different build identity at its executable URL.",
        true
      );
      return undefined;
    }
    if (
      !isBuildQueueId(details.queueId) &&
      (typeof details.building !== "boolean" ||
        !this.isUncontestedAssignment(owner, current, build, id, dispute.incumbent))
    ) {
      this.retryQueueConfirmation(
        entry,
        "Jenkins did not identify which queue item owns the executable URL."
      );
      return undefined;
    }
    this.commitQueueIdentity(owner, current, key, build, id, details);
    entry.disputedBuild = undefined;
    return details;
  }

  private isUncontestedAssignment(
    owner: FollowEntry,
    current: FollowEntry | undefined,
    build: FollowedBuild,
    id: number,
    incumbent: FollowEntry | undefined
  ): boolean {
    return (
      (!current || current === owner || current.runQueueId === id) &&
      !(current?.statusConflictOrder !== undefined && servesLiteral(current, build)) &&
      !(owner.statusConflictOrder !== undefined && servesLiteral(owner, build)) &&
      !this.registry.identifiesDifferentQueue(incumbent, id)
    );
  }

  private commitQueueIdentity(
    owner: FollowEntry,
    current: FollowEntry | undefined,
    key: string,
    build: FollowedBuild,
    id: number,
    details: RunStatus
  ): void {
    if (current && current !== owner && !this.registry.matchesRun(current, build.buildNumber, id)) {
      this.verifyRunAtUrl(key, current, details.number, id);
    }
    if (current && current !== owner && this.registry.isActive(current))
      rememberRunStatus(current, build.buildUrl, details);
    rememberRunStatus(owner, build.buildUrl, details);
  }

  /** A number-only response must wait for an earlier competing read to settle its ownership. */
  private waitForNumberedStatusConflict(
    subscription: FollowEntry,
    { entry: incumbent, request }: ReturnType<typeof observeIncumbent>,
    build: FollowedBuild,
    details: RunStatus
  ): Promise<void> | undefined {
    if (
      details.number !== build.buildNumber ||
      isBuildQueueId(details.queueId) ||
      typeof details.building !== "boolean"
    )
      return undefined;
    return this.waitForObservedRequest(subscription, { entry: incumbent, request }, false);
  }

  private waitForObservedRequest(
    subscription: FollowEntry,
    { entry: incumbent, request }: Pick<ReturnType<typeof observeIncumbent>, "entry" | "request">,
    waitForIdentifiedRun: boolean
  ): Promise<void> | undefined {
    if (
      !request ||
      incumbent?.statusRequest !== request ||
      (!waitForIdentifiedRun && incumbent.runQueueId !== undefined) ||
      !this.registry.isActive(incumbent) ||
      !this.registry.isActive(this.registry.current(subscription))
    )
      return undefined;
    return new Promise((resolve) => {
      const finish = () => {
        change.dispose();
        resolve();
      };
      const change = this.onDidChange(() => {
        if (
          !this.registry.isActive(this.registry.current(subscription)) ||
          !this.registry.isActive(incumbent) ||
          (!waitForIdentifiedRun && incumbent.runQueueId !== undefined)
        )
          finish();
      });
      void request.then(finish, finish);
    });
  }

  private retryQueueConfirmation(entry: FollowEntry, reason: string, terminal = false): void {
    // A late alias for a run already tracked at its own verified URL is optional.
    if (!this.canUseEntry(entry) || "buildUrl" in entry.target || entry.deferredCompletion) return;
    if (terminal || ++entry.consecutiveErrors >= this.maxConsecutiveErrors) {
      this.remove(entry);
      void vscode.window.showWarningMessage(
        `Stopped following ${followLabel(entry.target)}: ${reason}`
      );
    } else {
      this.schedule(entry);
    }
  }

  private verifyRunAtUrl(
    key: string,
    entry: FollowEntry,
    number: number,
    queueId?: number
  ): boolean {
    if (this.registry.matchesRun(entry, number, queueId)) return true;
    // Secondary routes are retired only by an ordered status read from that literal endpoint.
    if (entry.key !== key) return false;
    if (entry.deferredCompletion)
      this.releaseDeferredObservation(
        entry,
        this.alreadyAnnounced(entry, queueId, entry.deferredCompletion)
          ? alreadyHandled
          : panelDelivery
      );
    this.remove(entry);
    void vscode.window.showWarningMessage(
      `Stopped following ${followLabel(entry.target)}: Jenkins returned a different build identity.`
    );
    return false;
  }

  private bindRunQueue(entry: FollowEntry, build: FollowedBuild, queueId: number): FollowEntry {
    const binding = this.registry.bindQueue(entry, build, queueId);
    if (binding) this.applyBinding(binding);
    return binding?.owner ?? entry;
  }

  private attachExecutableAlias(owner: FollowEntry, build: FollowedBuild, queueId: number): void {
    const key = buildKey(build.environment, build.buildUrl);
    if (!this.canUseEntry(owner) || !this.verifyRunAtUrl(key, owner, build.buildNumber, queueId))
      return;
    const binding = this.registry.bindAlias(owner, build, queueId);
    if (binding) this.applyBinding(binding);
  }

  private applyBinding({ owner, merged }: FollowBinding): void {
    for (const previous of merged) {
      releasePolling(previous);
      const terminal = previous.deferredCompletion;
      previous.deferredCompletion = undefined;
      if (terminal) this.transferDeferredCompletion(owner, terminal);
    }
    if (owner.deferredCompletion) this.resumeDeferredCompletion(owner);
    if (this.registry.isActive(owner)) this.publish();
  }

  private transferDeferredCompletion(owner: FollowEntry, terminal: TerminalObservation): void {
    const existing = owner.deferredCompletion;
    if (existing && existing !== terminal) {
      if (compatibleCompletion(existing, terminal)) mergePanelClaims(existing, terminal);
      else this.releaseDeferredObservation(owner, panelDelivery);
    }
    owner.deferredCompletion = terminal;
  }

  private handoff(queue: FollowEntry, build: FollowedBuild): void {
    if ("buildUrl" in queue.target) return;
    const queueId = queue.target.queueId;
    const key = buildKey(build.environment, build.buildUrl);
    const existing = this.registry.lookup(key);
    if (existing) {
      if (!this.registry.matchesRun(existing, build.buildNumber, queueId)) return;
      this.bindRunQueue(existing, build, queueId);
      return;
    }
    if (queue.endedBuilds?.has(key)) {
      this.remove(queue);
    } else {
      this.add(key, build, queueId, queue);
    }
  }

  private handlePollError(entry: FollowEntry, error: unknown): void {
    const queued = !("buildUrl" in entry.target);
    entry.consecutiveErrors += 1;
    if (
      isNotFoundError(error) ||
      (queued && isTerminalClientError(error)) ||
      entry.consecutiveErrors >= this.maxConsecutiveErrors
    ) {
      const reason = isNotFoundError(error)
        ? queued
          ? "the queue item disappeared before Jenkins identified its build."
          : "the build no longer exists."
        : formatActionError(error);
      this.remove(entry);
      void vscode.window.showWarningMessage(
        `Stopped following ${followLabel(entry.target)}: ${reason}`
      );
      return;
    }
    this.schedule(entry);
  }

  /** Let an outstanding started notification see results delivered by Build Details itself. */
  recordPanelCompletion(build: FollowedBuildCompletion, decision?: PanelCompletionDecision): void {
    const { result, queueId } = build;
    if (this.disposed || !this.actions.isCurrentController(build.environment)) return;
    const noticeOrder = build.noticeOrder ?? nextBuildObservationOrder();
    if (!isBuildQueueId(queueId)) {
      const key = buildKey(build.environment, build.buildUrl);
      this.registry.rememberEndedBuild(build.environment, key, undefined, { result, noticeOrder });
      this.rememberResultDuringQueueReads(build, key, { result, noticeOrder });
      if (decision) this.commitUnverifiedResult(decision, result, noticeOrder);
    }
    this.emitCompletion({ ...build, result, queueId, source: "panel", noticeOrder });
  }

  /** A panel result is authoritative for its own queue ID; its numbered URL may have been reused. */
  async claimPanelCompletion({
    notice: completed,
    previouslyDelivered = false,
    subscribersOnly = false
  }: PanelCompletionRequest): Promise<PanelCompletionDecision> {
    const { result, queueId } = completed;
    if (this.disposed) return alreadyHandled;
    const key = buildKey(completed.environment, completed.buildUrl);
    const direct = this.registry.lookup(key);
    const identified = this.findPanelQueueSubscriber(completed);
    if (subscribersOnly && !this.hasCompletionSubscriber(completed, direct, identified))
      return alreadyHandled;
    if (
      direct &&
      "buildUrl" in direct.target &&
      direct.target.buildNumber !== completed.buildNumber
    ) {
      this.rejectMismatchedBuild(
        completed.environment,
        completed.observedUrl ?? completed.buildUrl,
        completed.buildNumber,
        completed.requestOrder
      );
      return alreadyHandled;
    }
    const claimed = isBuildQueueId(queueId)
      ? this.claimIdentifiedPanelResult(completed, queueId, identified, direct, previouslyDelivered)
      : this.claimAnonymousPanelResult(completed, direct, previouslyDelivered);
    if (claimed) return claimed;
    const claim = this.finishFollow(
      completed,
      result,
      queueId,
      previouslyDelivered ? "previously-notified" : "requested"
    );
    return previouslyDelivered ? alreadyHandled : this.panelDecisionFor(claim);
  }

  private findPanelQueueSubscriber(completed: FollowedBuildCompletion): FollowEntry | undefined {
    const { queueId } = completed;
    const queue = isBuildQueueId(queueId)
      ? this.registry.lookup(queueKey(completed.environment, queueId))
      : undefined;
    return queue &&
      (!("buildUrl" in queue.target) || queue.target.buildNumber === completed.buildNumber)
      ? queue
      : undefined;
  }

  private hasCompletionSubscriber(
    completed: FollowedBuildCompletion,
    direct: FollowEntry | undefined,
    identified: FollowEntry | undefined
  ): boolean {
    // A URL-only subscription may belong to a replacement at the same endpoint.
    if (isBuildQueueId(completed.queueId)) return identified !== undefined;
    return (
      direct !== undefined &&
      completed.requestOrder !== undefined &&
      completed.requestOrder >= latestIdentityOrder(direct) &&
      this.registry.matchesRun(direct, completed.buildNumber, undefined)
    );
  }

  private claimAnonymousPanelResult(
    completed: FollowedBuildCompletion,
    direct: FollowEntry | undefined,
    previouslyDelivered: boolean
  ): PanelCompletionDecision | Promise<PanelCompletionDecision> | undefined {
    if (!direct) return undefined;
    if (previouslyDelivered) return alreadyHandled;
    if (direct.runQueueId === undefined) return undefined;
    return direct.checkingPanelResult
      ? alreadyHandled
      : this.confirmPanelResult(direct, completed, completed.result);
  }

  private claimIdentifiedPanelResult(
    completed: FollowedBuildCompletion,
    queueId: number,
    identified: FollowEntry | undefined,
    direct: FollowEntry | undefined,
    previouslyDelivered: boolean
  ): PanelCompletionDecision | undefined {
    if (identified) {
      rememberRunEndpoint(
        identified,
        completed.observedUrl ?? completed.buildUrl,
        queueId,
        completed.requestOrder
      );
      return undefined;
    }
    if (!direct || direct.runQueueId !== undefined || !this.canUseEntry(direct)) return undefined;
    // This result has an identity, while the URL subscription may own a replacement.
    const { result } = completed;
    const announced = this.alreadyAnnounced(direct, queueId, { result });
    this.markCompletionCandidates(completed, queueId, result);
    if (previouslyDelivered || announced) return alreadyHandled;
    this.publishCompletionIdentity(completed, queueId, result, []);
    this.notifyCompletion(completed, result, queueId, true);
    return trackerDelivery;
  }

  private panelDecisionFor(
    claim: CompletionClaim
  ): PanelCompletionDecision | Promise<PanelCompletionDecision> {
    if (claim.disposition !== "pending") return claim;
    if (claim.terminal.previouslyDelivered || claim.terminal.resolvePanelClaim)
      return alreadyHandled;
    return new Promise<PanelCompletionDecision>((resolve) => {
      claim.terminal.resolvePanelClaim = resolve;
    });
  }

  private alreadyAnnounced(
    entry: FollowEntry,
    id: number | undefined,
    observed: PriorResult
  ): boolean {
    const notice = noticeForQueue(entry, id);
    return notice !== undefined && buildResultsCompatible(notice.result, observed.result);
  }

  private unverifiedPanelDelivery(
    entry: FollowEntry,
    build: FollowedBuild,
    result?: string
  ): PanelCompletionDecision {
    const decision = { disposition: "panel", verification: "inconclusive" } as const;
    this.pendingPanelPresentations.set(decision, {
      entry,
      result,
      requestOrder: build.requestOrder ?? nextBuildObservationOrder()
    });
    return decision;
  }

  private commitUnverifiedResult(
    decision: PanelCompletionDecision,
    result: string | undefined,
    noticeOrder: number
  ): void {
    const pending = this.pendingPanelPresentations.get(decision);
    if (!pending) return;
    this.pendingPanelPresentations.delete(decision);
    const owner = this.registry.current(pending.entry);
    if (
      this.registry.isActive(owner) &&
      result === pending.result &&
      owner.latestRunningOrder <= pending.requestOrder &&
      noticeOrder > (owner.deliveredPanelNotice?.noticeOrder ?? 0)
    )
      owner.deliveredPanelNotice = { result, noticeOrder };
  }

  /** A panel result without a queue ID cannot take the identity of the run now at its URL. */
  private async confirmPanelResult(
    entry: FollowEntry,
    build: FollowedBuild,
    result?: string
  ): Promise<PanelCompletionDecision> {
    entry.checkingPanelResult = true;
    try {
      const owned = entry.target;
      if (!("buildUrl" in owned)) return panelDelivery;
      const details = await this.readBuildStatus(owned).catch(() => undefined);
      if (this.disposed || !this.actions.isCurrentController(build.environment))
        return alreadyHandled;
      if (!this.registry.isActive(entry))
        return entry.completion && buildResultsCompatible(entry.completion.result, result)
          ? alreadyHandled
          : panelDelivery;
      if (!details || typeof details.building !== "boolean")
        return this.unverifiedPanelDelivery(entry, build, result);
      if (!matchesPanelVerification(entry, build.buildNumber, details)) return panelDelivery;
      rememberRunStatus(entry, owned.buildUrl, details);
      if (details.building) {
        return isBuildQueueId(details.queueId)
          ? { disposition: "panel", verifiedRunningQueueId: details.queueId }
          : panelDelivery;
      }
      const same = buildResultsCompatible(result, details.result);
      const claim = this.finishFollow(
        owned,
        details.result ?? result,
        entry.runQueueId,
        "requested",
        entry,
        details.requestOrder
      );
      return same ? await this.panelDecisionFor(claim) : panelDelivery;
    } finally {
      entry.checkingPanelResult = false;
    }
  }

  private finishFollow(
    completed: FollowedBuild,
    result: string | undefined,
    queueId?: number,
    delivery: CompletionDelivery = "requested",
    verified?: FollowEntry,
    statusRequestOrder?: number
  ): CompletionClaim {
    const { environment, buildUrl } = completed;
    const key = buildKey(environment, buildUrl);
    const urlOwner = this.registry.lookup(key);
    const id = isBuildQueueId(queueId) ? queueId : undefined;
    const direct =
      !isBuildQueueId(id) || urlOwner?.runQueueId === id || verified === urlOwner
        ? urlOwner
        : undefined;
    const aliases = isBuildQueueId(id)
      ? this.matchCompletedQueue(completed, key, id, result, direct)
      : [];
    const entry = direct ? this.registry.current(direct) : aliases[0];
    if (!entry || !this.canUseEntry(entry)) {
      return direct?.completion || delivery !== "requested" ? alreadyHandled : panelDelivery;
    }
    const terminal = this.captureTerminalObservation(
      entry,
      completed,
      result,
      id,
      delivery,
      statusRequestOrder
    );
    const deferred =
      id === undefined
        ? this.deferAnonymousCompletion(entry, terminal, completed.requestOrder, verified)
        : this.deferNumberedCompletion(entry, aliases, terminal, completed, id);
    if (deferred) return { disposition: "pending", terminal: deferred };
    return this.deliverFollowCompletion(entry, aliases, completed, terminal, key);
  }

  private deliverFollowCompletion(
    entry: FollowEntry,
    aliases: FollowEntry[],
    completed: FollowedBuild,
    terminal: TerminalObservation,
    key: string
  ): CompletionClaim {
    const { queueId: id } = terminal;
    const { environment } = completed;
    const build = "buildUrl" in entry.target ? entry.target : completed;
    const action = actionEvidence(entry, build, id);
    const previous = previousCompletionNotice(entry, terminal, id);
    const alreadyNotified = terminal.previouslyDelivered || Boolean(previous);
    const noticeOrder = previous?.noticeOrder ?? nextBuildObservationOrder();
    if (id === undefined)
      this.rememberResultDuringQueueReads(build, key, { result: terminal.result, noticeOrder });
    const actionOwner = this.registry.lookup(buildKey(environment, build.buildUrl));
    const disputedAction = actionOwner && actionOwner !== entry && actionOwner.runQueueId !== id;
    this.publishCompletionIdentity(
      terminal.build.requestOrder === undefined
        ? build
        : { ...build, requestOrder: terminal.build.requestOrder },
      id,
      terminal.result,
      [entry, ...aliases],
      completed.buildUrl,
      noticeOrder
    );
    const decision = alreadyNotified ? alreadyHandled : trackerDelivery;
    resolvePanelClaim(terminal, decision);
    this.remove(entry);
    for (const alias of aliases) this.remove(alias);
    if (!alreadyNotified)
      this.notifyCompletion(
        build,
        terminal.result,
        action.queueId,
        Boolean(disputedAction) || action.requireQueueId,
        entry
      );
    return decision;
  }

  private deferNumberedCompletion(
    entry: FollowEntry,
    aliases: FollowEntry[],
    terminal: TerminalObservation,
    completed: FollowedBuild,
    id: number
  ): TerminalObservation | undefined {
    const prior = [entry, ...aliases].find(
      (owner) =>
        owner.queueRead?.waiters && owner.queueRead.priorResults?.has(completed.buildNumber)
    );
    if (!prior?.queueRead?.waiters) return undefined;
    const owner = entry !== prior ? this.bindRunQueue(entry, completed, id) : entry;
    prior.queueRead.waiters.add(owner);
    owner.deferredCompletion = { ...terminal, queueId: id };
    clearEntryTimer(owner);
    return owner.deferredCompletion;
  }

  private deferAnonymousCompletion(
    entry: FollowEntry,
    terminal: TerminalObservation,
    requestOrder?: number,
    verified?: FollowEntry
  ): TerminalObservation | undefined {
    // An anonymous response can predate independent evidence for the current run.
    // Let the outstanding read or an immediate verification decide which result it owns.
    const identityOrder = latestIdentityOrder(entry);
    if (
      !verified &&
      requestOrder !== undefined &&
      requestOrder < identityOrder &&
      (terminal.statusRequestOrder ?? 0) < identityOrder
    )
      terminal.verifyAfterOrder = identityOrder;
    const waiting = this.waitForCompletedQueues(entry);
    if (!waiting && terminal.verifyAfterOrder === undefined) return undefined;
    entry.deferredCompletion = terminal;
    clearEntryTimer(entry);
    if (terminal.verifyAfterOrder !== undefined) this.resumeDeferredCompletion(entry);
    return terminal;
  }

  private waitForCompletedQueues(entry: FollowEntry): boolean {
    let waiting = Boolean(entry.statusRequest);
    for (const { read } of entry.completedQueues?.values() ?? []) {
      if (!read?.waiters) continue;
      read.waiters.add(entry);
      waiting = true;
    }
    return waiting;
  }

  private captureTerminalObservation(
    entry: FollowEntry,
    completed: FollowedBuild,
    result: string | undefined,
    id: number | undefined,
    delivery: CompletionDelivery,
    statusRequestOrder?: number
  ): TerminalObservation {
    const earlier = entry.deferredCompletion;
    if (earlier && !compatibleCompletion(earlier, { queueId: id, result }))
      this.releaseDeferredObservation(entry, panelDelivery);
    const pending = entry.deferredCompletion;
    const verifiedOrder = latestKnownOrder(statusRequestOrder, pending?.statusRequestOrder);
    const observedOrder = latestKnownOrder(
      verifiedOrder,
      completed.requestOrder,
      pending?.build.requestOrder
    );
    return {
      ...pending,
      previousCompletion: pending ? pending.previousCompletion : entry.previousCompletion,
      action: pending?.action ?? actionEvidence(entry, completed, id),
      statusRequestOrder: verifiedOrder,
      build:
        observedOrder === completed.requestOrder
          ? completed
          : { ...completed, requestOrder: observedOrder },
      result: result ?? pending?.result ?? noticeForQueue(entry, id)?.result,
      previouslyDelivered:
        Boolean(pending?.previouslyDelivered) || delivery === "previously-notified",
      queueId: id
    };
  }

  private rememberResultDuringQueueReads(
    build: FollowedBuild,
    key: string,
    receipt: PriorResult
  ): void {
    for (const entry of this.registry.active()) {
      const read = entry.queueRead;
      if (!read?.waiters || !sameController(entry.target.environment, build.environment)) continue;
      if ("buildUrl" in entry.target && entry.target.buildNumber !== build.buildNumber) continue;
      read.priorResults ??= new Map();
      const urls = read.priorResults.get(build.buildNumber) ?? new Map<string, PriorResult>();
      urls.set(key, receipt);
      read.priorResults.set(build.buildNumber, urls);
    }
  }

  private emitCompletion(notice: FollowedBuildCompletion): void {
    if (isBuildQueueId(notice.queueId) && notice.noticeOrder !== undefined) {
      this.rememberNumberedNotice(notice, notice.queueId, notice.noticeOrder);
      this.correlateQueueNotices(notice, notice.queueId, notice.noticeOrder);
    }
    this.completions.fire(notice);
  }

  private rememberNumberedNotice(notice: FollowedBuildCompletion, id: number, order: number): void {
    for (const url of [notice.buildUrl, ...(notice.aliases ?? [])]) {
      const direct = this.registry.lookup(buildKey(notice.environment, url));
      if (
        !direct ||
        direct.runQueueId !== undefined ||
        !("buildUrl" in direct.target) ||
        direct.target.buildNumber !== notice.buildNumber ||
        (direct.announcedAtUrl?.noticeOrder ?? 0) > order
      )
        continue;
      direct.announcedAtUrl = {
        result: notice.result,
        queueId: id,
        noticeOrder: order
      };
    }
  }

  private correlateQueueNotices(notice: FollowedBuildCompletion, id: number, order: number): void {
    for (const candidate of this.registry.active()) {
      if (
        !sameController(candidate.target.environment, notice.environment) ||
        !("buildUrl" in candidate.target) ||
        candidate.target.buildNumber !== notice.buildNumber
      )
        continue;
      const previous = candidate.completedQueues?.get(id);
      if (previous && buildResultsCompatible(previous.result, notice.result))
        previous.noticeOrder ??= order;
    }
  }

  private publishCompletionIdentity(
    build: FollowedBuild,
    queueId: number | undefined,
    result: string | undefined,
    entries: FollowEntry[],
    observedUrl = build.buildUrl,
    noticeOrder = nextBuildObservationOrder()
  ): void {
    const owners = new Set(entries);
    const urls = new Set([observedUrl]);
    for (const owner of owners) {
      if ("buildUrl" in owner.target) urls.add(owner.target.buildUrl);
    }
    for (const url of this.registry.buildAliases(owners)) urls.add(url);
    urls.delete(build.buildUrl);
    // A later read may verify another URL for an already announced run. The panel
    // still needs that identity so it can recognize the result on its own endpoint.
    const notice = { ...build, queueId, result, aliases: [...urls], noticeOrder };
    for (const owner of owners) owner.completion = notice;
    this.emitCompletion(notice);
  }

  /** A queueId can prove that two plugin URLs identify the same run on this controller. */
  private matchCompletedQueue(
    completed: FollowedBuild,
    completedKey: string,
    id: number,
    result: string | undefined,
    direct?: FollowEntry
  ): FollowEntry[] {
    const key = queueKey(completed.environment, id);
    const pending = this.registry.pendingQueue(key);
    const occupant = this.registry.lookup(completedKey);
    if (pending && (!occupant || occupant === direct) && this.canUseEntry(pending))
      this.handoff(pending, completed);
    const owner = this.registry.lookup(key);
    this.markCompletionCandidates(completed, id, result, owner?.queueRead, direct);
    return owner &&
      (!("buildUrl" in owner.target) || owner.target.buildNumber === completed.buildNumber)
      ? [owner]
      : [];
  }

  private markCompletionCandidates(
    completed: FollowedBuild,
    id: number,
    result: string | undefined,
    read?: QueueIdentityRead,
    direct?: FollowEntry
  ): void {
    for (const entry of this.registry.active()) {
      const { target } = entry;
      if (
        entry === direct ||
        entry.runQueueId !== undefined ||
        !("buildUrl" in target) ||
        target.buildNumber !== completed.buildNumber ||
        !sameController(target.environment, completed.environment)
      )
        continue;
      entry.completedQueues ??= new Map();
      const previous = entry.completedQueues.get(id);
      entry.completedQueues.set(id, {
        read: read ?? previous?.read,
        result: result ?? previous?.result,
        noticeOrder:
          previous && buildResultsCompatible(previous.result, result)
            ? previous.noticeOrder
            : undefined
      });
    }
  }

  private actionEndpoint(
    build: FollowedBuild,
    owner: FollowEntry | undefined,
    expectedId: () => number | undefined,
    noticeOrder?: number
  ): EndpointConsumer {
    const literalOwner = servesLiteral(owner, build) ? owner : undefined;
    const registry = this.registry;
    return {
      target: build,
      get runQueueId() {
        return expectedId();
      },
      get completionOrder() {
        return noticeOrder ?? (owner && registry.current(owner).completion?.noticeOrder);
      },
      requireQueueId: literalOwner?.requireQueueId,
      latestRunningOrder: literalOwner?.latestRunningOrder ?? 0,
      latestIdentityOrder: literalOwner?.latestIdentityOrder,
      statusConflictOrder: literalOwner?.statusConflictOrder
    };
  }

  private notifyCompletion(
    build: FollowedBuild,
    result: string | undefined,
    queueId?: number,
    requireQueueId = false,
    owner?: FollowEntry
  ): void {
    const status = formatCompletionStatus(result);
    const message = `${build.label} finished: ${status.label}.`;
    const selection =
      status.severity === "warning"
        ? vscode.window.showWarningMessage(message, VIEW_BUILD_DETAILS_ACTION, PREVIEW_LOG_ACTION)
        : vscode.window.showInformationMessage(
            message,
            VIEW_BUILD_DETAILS_ACTION,
            PREVIEW_LOG_ACTION
          );
    const consumer = this.actionEndpoint(
      build,
      owner,
      () => queueId,
      owner?.completion?.noticeOrder ?? nextBuildObservationOrder()
    );
    consumer.requireQueueId ||= requireQueueId;
    void this.withEndpointAction(consumer, async () =>
      this.handleCompletionSelection(
        queueId === undefined ? build : { ...build, queueId },
        await selection,
        result,
        consumer
      )
    );

    try {
      this.actions.refreshEnvironment(build.environment.environmentId);
    } catch {
      // Refreshing is best effort; the notification already went out.
    }
  }

  private async handleCompletionSelection(
    build: FollowedBuild,
    selection: string | undefined,
    result: string | undefined,
    consumer: EndpointConsumer
  ): Promise<void> {
    if (!selection || this.disposed) return;
    if (!this.actions.isCurrentController(build.environment)) {
      void vscode.window.showInformationMessage(
        `The Jenkins environment for ${build.label} has changed.`
      );
      return;
    }
    const status = await this.readBuildStatus(build).catch(() => undefined);
    if (this.disposed) return;
    const current = this.registry.lookup(buildKey(build.environment, build.buildUrl));
    if (
      !this.actions.isCurrentController(build.environment) ||
      !matchesCompletionSelection(build, status, current, consumer, result)
    ) {
      void vscode.window.showWarningMessage(
        `Unable to open ${build.label}: Jenkins could not confirm this result at its numbered URL.`
      );
      return;
    }
    const target = buildActionTarget(build, status, build.queueId);
    if (selection === VIEW_BUILD_DETAILS_ACTION) {
      await this.runAction("Unable to open build details", () =>
        this.actions.showBuildDetails(target)
      );
    } else if (selection === PREVIEW_LOG_ACTION) {
      await this.runAction("Unable to preview build log", () => this.actions.previewLog(target));
    }
  }

  private async runAction(
    messagePrefix: string,
    action: () => Promise<void> | void
  ): Promise<void> {
    await withActionErrorMessage(messagePrefix, async () => {
      await action();
    });
  }

  private remove(entry: FollowEntry | undefined, cause: "release" | "user-stop" = "release"): void {
    if (!entry || !this.registry.isActive(entry)) {
      return;
    }
    if (cause === "user-stop") this.userStops.fire(entry);
    if (!this.registry.release(entry, cause)) return;
    releasePolling(entry);
    entry.deferredCompletion?.resolvePanelClaim?.(alreadyHandled);
    this.publish();
  }

  private publish(): void {
    this.renderStatusBar();
    this.changes.fire();
  }

  private renderStatusBar(): void {
    if (this.disposed) {
      return;
    }
    const count = this.registry.size;
    if (count === 0) {
      this.statusBarItem?.hide();
      return;
    }
    if (!this.statusBarItem) {
      this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
      this.statusBarItem.command = SHOW_FOLLOWED_BUILDS_COMMAND;
    }
    const labels = Array.from(this.registry.active(), ({ target }) => `- ${followLabel(target)}`);
    this.statusBarItem.text = `$(eye) ${count} following`;
    this.statusBarItem.tooltip = ["Following Jenkins builds:", ...labels].join("\n");
    this.statusBarItem.show();
  }
}

function releasePolling(entry: FollowEntry): void {
  entry.queueObservationEnd?.settle();
  entry.queueObservationEnd = undefined;
  clearEntryTimer(entry);
  entry.queueRead?.waiters?.delete(entry);
  for (const { read } of entry.completedQueues?.values() ?? []) read?.waiters?.delete(entry);
  entry.cancellationWatch?.dispose();
}

function clearEntryTimer(entry: FollowEntry): void {
  if (entry.timer !== undefined) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }
}
