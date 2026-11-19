import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import {
  type JenkinsBuildUrlSource,
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment
} from "../../jenkins/urls";
import {
  isBuildQueueId,
  requestStartedAfterNotice
} from "../../shared/build/BuildCompletionEvidence";
import type { FollowedBuild, FollowedBuildCompletion } from "./BuildFollowTypes";

/** Only remembers notifications overlapping discovery and the user's started-banner choice. */
export class StartedBuildCompletionWatch implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;
  private pending: FollowedBuildCompletion[] = [];
  private target?: FollowedBuild;
  private targetUrl?: string;
  private runningRequestOrder?: number;
  notified = false;
  possibleCompletion?: FollowedBuildCompletion;

  constructor(
    completions: vscode.Event<FollowedBuildCompletion>,
    environment: JenkinsEnvironmentRef,
    queueId?: number
  ) {
    this.subscription = completions((notice) => {
      const other = notice.environment;
      if (
        environment.scope !== other.scope ||
        environment.environmentId !== other.environmentId ||
        normalizeJenkinsUrlForComparison(environment.url) !==
          normalizeJenkinsUrlForComparison(other.url) ||
        (isBuildQueueId(queueId) && isBuildQueueId(notice.queueId) && queueId !== notice.queueId)
      )
        return;
      if (this.target) this.match(notice);
      else this.pending.push(notice);
    });
  }

  identify(
    build: FollowedBuild,
    source: JenkinsBuildUrlSource,
    runningRequestOrder?: number
  ): void {
    this.runningRequestOrder = runningRequestOrder;
    this.target = build;
    this.targetUrl = resolveBuildIdentityForEnvironment(
      build.environment.url,
      build.buildUrl,
      "comparison",
      build,
      source
    )?.buildUrl;
    for (const notice of this.pending) this.match(notice);
    this.pending = [];
  }

  private match(notice: FollowedBuildCompletion): void {
    const build = this.target;
    if (this.notified || !build || notice.buildNumber !== build.buildNumber) return;
    if (isBuildQueueId(build.queueId) && isBuildQueueId(notice.queueId)) {
      if (build.queueId === notice.queueId) {
        this.notified = true;
        this.subscription.dispose();
      }
      return;
    }
    // A numbered endpoint seen running by a request begun after the announcement has been reused.
    if (requestStartedAfterNotice(this.runningRequestOrder, notice.noticeOrder)) return;
    // Without both queue IDs, the URL may since have been reused. The tracker
    // compares this possible duplicate against the next fresh run status.
    if (
      this.targetUrl &&
      (notice.noticeOrder === undefined ||
        this.possibleCompletion?.noticeOrder === undefined ||
        notice.noticeOrder >= this.possibleCompletion.noticeOrder) &&
      [notice.buildUrl, ...(notice.aliases ?? [])].some(
        (url) =>
          resolveBuildIdentityForEnvironment(
            build.environment.url,
            url,
            "comparison",
            notice,
            "configured"
          )?.buildUrl === this.targetUrl
      )
    )
      this.possibleCompletion = notice;
  }

  dispose(): void {
    this.subscription.dispose();
    this.pending = [];
  }
}
