import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";

export type TriggerCauseKind = "rebuild" | "replay" | "restart";

/** A build submitted through the queue API; Jenkins returned (or may have returned) a queue item. */
export interface QueueTriggeredBuildOrigin {
  kind: "queue";
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  /** Job label used in messages, for example "folder/my-job". */
  label: string;
  queueLocation?: string;
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

/** A started build the follow-up acts on. `label` already includes the build number. */
export interface FollowedBuild {
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  buildNumber: number;
  /** For example "folder/my-job #42". */
  label: string;
}

/** What the follow-up and the completion tracker can do with a started build. */
export interface FollowedBuildActions {
  showBuildDetails(build: FollowedBuild): Promise<void> | void;
  previewLog(build: FollowedBuild): Promise<void> | void;
}

export type TriggeredBuildLocation =
  | ({ kind: "started" } & FollowedBuild)
  | { kind: "cancelled" }
  | { kind: "unknown" };

export type { PollCancellationToken as TriggeredBuildLocatorToken } from "../polling/Polling";
