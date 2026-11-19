import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { BuildRunExpectation } from "../../shared/build/BuildCompletionEvidence";

export type TriggerCauseKind = "rebuild" | "replay" | "restart";

import type { QueueExecutable, SubmittedQueueObservations } from "./FollowedQueueBuild";

/** A build submitted through the queue API; Jenkins returned (or may have returned) a queue item. */
export interface QueueTriggeredBuildOrigin {
  kind: "queue";
  environment: JenkinsEnvironmentRef;
  /** Independently verified job, when known, for a number-only executable. */
  jobUrl?: string;
  /** Job label used in messages, for example "folder/my-job". */
  label: string;
  queueLocation?: string;
  observations?: SubmittedQueueObservations;
}

/**
 * A build submitted through an action that returns no queue item (rebuild, replay, restart).
 * The new build is found by scanning numbers from `firstCandidateNumber`, read before submitting,
 * and matching its cause against the source build.
 */
export interface CauseTriggeredBuildOrigin {
  kind: "cause";
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  label: string;
  firstCandidateNumber: number;
  sourceBuildNumber: number;
  cause: TriggerCauseKind;
  /** Restart only: the stage the build restarts from. */
  stageName?: string;
}

export type TriggeredBuildOrigin = QueueTriggeredBuildOrigin | CauseTriggeredBuildOrigin;

/** A one-run subscription started from an exact queue row. */
export interface FollowedQueueItem {
  environment: JenkinsEnvironmentRef;
  queueId: number;
  /** Job label without the queue ID. */
  label: string;
  taskUrl?: string;
}

export type FollowBuildResult = "following" | "already-following" | "unidentified" | "disposed";

/** A started build the follow-up acts on. `label` already includes the build number. */
export interface FollowedBuild {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildNumber: number;
  /** The literal URL read for this observation, when different from its resolved numbered endpoint. */
  observedUrl?: string;
  /** Window-local order at which the status request began. */
  requestOrder?: number;
  /** Positive Jenkins queue ID supplied by the Run API, when available. */
  queueId?: number;
  /** For example "folder/my-job #42". */
  label: string;
}

export interface FollowedBuildCompletion extends FollowedBuild {
  /** Order of the original notification, retained when a later read identifies an alias. */
  noticeOrder?: number;
  /** A standalone panel toast already claimed its slot in the emitting panel. */
  source?: "panel";
  /** Outcome from the terminal status, when Jenkins supplied one. */
  result?: string;
  /** Other numbered endpoints verified to identify this run. */
  aliases?: readonly string[];
}

export interface PanelCompletionRequest {
  notice: FollowedBuildCompletion;
  /** A matching notification was already presented for this panel load. */
  previouslyDelivered?: boolean;
  /** An observation without a panel completion transition may notify only an existing matching follow. */
  subscribersOnly?: boolean;
}

export type PanelCompletionDecision =
  | { disposition: "tracker" }
  | { disposition: "handled" }
  | { disposition: "panel"; verifiedRunningQueueId?: number; verification?: "inconclusive" };

export type FollowedBuildActionTarget = FollowedBuild & BuildRunExpectation;

/** What the follow-up and the completion tracker can do with a started build. */
export interface FollowedBuildActions {
  showBuildDetails(build: FollowedBuildActionTarget): Promise<void> | void;
  previewLog(build: FollowedBuildActionTarget): Promise<void> | void;
}

export type TriggeredBuildLocation =
  | ({
      kind: "started";
      /** An uncached cause lookup confirmed the build number at this exact configured endpoint. */
      causeObservation?: { requestOrder: number; building?: boolean };
    } & QueueExecutable)
  | { kind: "cancelled" }
  | { kind: "unknown" };

export type { PollCancellationToken as TriggeredBuildLocatorToken } from "../polling/Polling";
