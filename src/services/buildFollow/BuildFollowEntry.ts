import type { JenkinsBuildDetails } from "../../jenkins/types";
import { normalizeJenkinsUrlForComparison } from "../../jenkins/urls";
import { isBuildQueueId } from "../../shared/build/BuildCompletionEvidence";
import type { PollBackoff } from "../polling/Polling";
import type {
  FollowedBuild,
  FollowedBuildCompletion,
  FollowedQueueItem,
  PanelCompletionDecision
} from "./BuildFollowTypes";
import type { QueueExecutable, QueueItemEvidence } from "./FollowedQueueBuild";

export type FollowTarget = FollowedBuild | FollowedQueueItem;
export type PreviousCompletion = Pick<
  FollowedBuildCompletion,
  "result" | "queueId" | "noticeOrder"
>;
export type RunStatus = JenkinsBuildDetails & { requestOrder: number };

/** One active observer of a scoped queue item. Only one observer can claim its cancellation. */
export interface QueueCancellationWatch {
  claim(): boolean;
  dispose(): void;
}

export interface PriorResult {
  result?: string;
  noticeOrder?: number;
}

/** Waiters exist only while this particular queue request can still identify an executable. */
export interface QueueIdentityRead {
  provideExecutable?: (build: QueueExecutable) => void;
  locatedBuild?: QueueExecutable;
  settled: Promise<void>;
  settle(): void;
  waiters?: Set<FollowEntry>;
  /** Direct URL results announced before this queue's executable was identified. */
  priorResults?: Map<number, Map<string, PriorResult>>;
}

export interface TerminalObservation {
  /** The Run API request that verified this terminal state, when available. */
  statusRequestOrder?: number;
  /** An older running response can't resolve this later terminal observation. */
  verifyAfterOrder?: number;
  /** Evidence available when this result was received, before another run could replace it. */
  previousCompletion?: PreviousCompletion;
  action: { queueId?: number; requireQueueId: boolean };
  /** Lets Build Details show its own notice if this result belonged to another run. */
  resolvePanelClaim?: (decision: PanelCompletionDecision) => void;
  build: FollowedBuild;
  result?: string;
  queueId?: number;
  previouslyDelivered: boolean;
}

/** Identity evidence lives only for an active subscription or an offered UI action. */
export interface EndpointConsumer {
  target: FollowTarget;
  runQueueId?: number;
  latestRunningOrder: number;
  /** A terminal action may use a number-only fallback only while its endpoint evidence permits it. */
  requireQueueId?: boolean;
  readonly completionOrder?: number;
  /** Last request that established identity on this literal endpoint. */
  latestIdentityOrder?: number;
  /** Only a later request confirming the followed run may clear this conflict. */
  statusConflictOrder?: number;
}

interface ObservedQueueIdentity {
  queueId: number;
  requestOrder: number;
}

export interface FollowEntry extends EndpointConsumer {
  cancellationWatch?: QueueCancellationWatch;
  key: string;
  backoff: PollBackoff;
  consecutiveErrors: number;
  timer?: ReturnType<typeof setTimeout>;
  /** A directly followed build can finish or be stopped while its queue item is still resolving. */
  endedBuilds?: Set<string>;
  /** A previous result at this URL lacked a queue ID and may belong to a replaced run. */
  unverifiedResults?: Map<string, PriorResult>;
  /** Lets an outstanding queue read corroborate an alternate URL after a result was announced. */
  completion?: FollowedBuildCompletion;
  /** Queue IDs supplied by literal status endpoints, independently of the subscription binding. */
  observedRunIds?: Map<string, ObservedQueueIdentity>;
  /** The panel identified the displayed run while the direct subscription still lacked its own queue identity. */
  observedPanelIdentity?: ObservedQueueIdentity;
  /** Result announced while the user was waiting on or choosing the started banner. */
  previousCompletion?: PreviousCompletion;
  /** A result announced for this exact numbered URL. A later running read rules out a match by URL alone. */
  announcedAtUrl?: PreviousCompletion;
  /** Results already announced while this same-numbered run's queue identity was still unknown. */
  completedQueues?: Map<number, PriorResult & { read?: QueueIdentityRead }>;
  queueEvidence?: QueueItemEvidence;
  /** Releases an expired automatic lookup when this observer can no longer contribute facts. */
  queueObservationEnd?: { settled: Promise<void>; settle(): void };
  queueRead?: QueueIdentityRead;
  /** Retry a known route even after Jenkins removes its queue record. */
  queueExecutable?: QueueExecutable;
  statusRequest?: Promise<RunStatus>;
  /** Independent reads by an action may still prove completion after a poll fails. */
  competingStatuses?: Map<Promise<RunStatus | undefined>, number | undefined>;
  checkingPanelResult?: boolean;
  /** An anonymous result actually presented while this follow's endpoint was unverifiable. */
  deliveredPanelNotice?: PriorResult & { noticeOrder: number };
  /** Keep the executable and the competing URL subscription's identity across verification retries. */
  disputedBuild?: { build: FollowedBuild; incumbent?: FollowEntry };
  deferredCompletion?: TerminalObservation;
}

export function rememberRunEndpoint(
  entry: FollowEntry | undefined,
  requestUrl: string,
  queueId?: number,
  requestOrder = 0
): void {
  if (!entry || !isBuildQueueId(queueId)) return;
  const url = normalizeJenkinsUrlForComparison(requestUrl, entry.target.environment.url);
  entry.observedRunIds ??= new Map();
  if ((entry.observedRunIds.get(url)?.requestOrder ?? -1) <= requestOrder)
    entry.observedRunIds.set(url, { queueId, requestOrder });
}
