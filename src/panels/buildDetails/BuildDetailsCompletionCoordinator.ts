import type { JenkinsBuildDetails } from "../../jenkins/types";
import type { BuildCompletionTracker } from "../../services/buildFollow/BuildCompletionTracker";
import type {
  FollowedBuildCompletion,
  PanelCompletionDecision
} from "../../services/buildFollow/BuildFollowTypes";
import {
  type BuildDetailsPanelState,
  getPanelBuildRequestOrder,
  resolveDisplayedFollowTarget
} from "./BuildDetailsPanelState";
import { mismatchedPanelRunUrl, resolveDisplayedRun } from "./BuildDetailsRunIdentity";
import { isBuildQueueId } from "./shared/BuildDetailsContracts";

export type PanelCompletionTracker = Pick<
  BuildCompletionTracker,
  | "claimPanelCompletion"
  | "observeRunningBuild"
  | "observeBuildIdentity"
  | "rejectMismatchedBuild"
  | "recordPanelCompletion"
>;

/**
 * Routes each completion to one notification owner. The tracker verifies active follows and
 * resolves queue handoffs. The panel retains receipts for messages it presents during this
 * load, including concurrent reports that settle after navigation.
 */
export class BuildDetailsCompletionCoordinator {
  constructor(
    private readonly state: BuildDetailsPanelState,
    private readonly tracker: PanelCompletionTracker | undefined,
    private readonly present: (details: JenkinsBuildDetails, buildUrl?: string) => Promise<void>
  ) {}

  /** Fresh identity evidence is useful even when this panel did not observe a completion transition. */
  observeDetails(details: JenkinsBuildDetails, superseded = false): void {
    const { environment, currentBuildUrl } = this.state;
    if (!this.tracker || !environment || !currentBuildUrl) return;
    if (mismatchedPanelRunUrl(environment, currentBuildUrl, details.number)) {
      this.tracker.rejectMismatchedBuild(
        environment,
        currentBuildUrl,
        details.number,
        getPanelBuildRequestOrder(details)
      );
      return;
    }
    const target = resolveDisplayedFollowTarget(environment, currentBuildUrl, details);
    if (!target) return;
    const observed = isBuildQueueId(details.queueId)
      ? { ...target, queueId: details.queueId }
      : target;
    if (details.building === true && !superseded) {
      this.tracker.observeRunningBuild(observed, true);
      return;
    }
    this.tracker.observeBuildIdentity(observed, details.building, superseded);
    // A partial Run can identify an executable without proving it is still running.
    // Bind only its identity; the tracker will poll that exact run for its result.
    if (details.building === undefined && isBuildQueueId(observed.queueId) && !superseded)
      this.tracker.observeRunningBuild(observed, false);
    // A first terminal read has no panel transition to announce, but the Run may
    // already identify an explicit follow whose queue item is about to expire.
    if (details.building === false && (isBuildQueueId(observed.queueId) || superseded))
      void this.claimSubscription(details, { ...observed, result: details.result });
  }

  private async claimSubscription(
    details: JenkinsBuildDetails,
    notice: FollowedBuildCompletion | undefined
  ): Promise<PanelCompletionDecision> {
    if (!notice || !this.tracker) return { disposition: "handled" };
    if (!isBuildQueueId(notice.queueId) && this.state.hasNewerDisplayedDetails(details)) {
      const displayed = resolveDisplayedFollowTarget(
        this.state.environment,
        this.state.currentBuildUrl,
        this.state.currentDetails
      );
      if (!displayed || displayed.buildUrl === notice.buildUrl) return { disposition: "handled" };
    }
    const decision = await this.tracker.claimPanelCompletion({
      notice,
      subscribersOnly: true,
      previouslyDelivered: this.state.hasCompletionNotice(details)
    });
    return decision.disposition === "panel" ? { disposition: "handled" } : decision;
  }

  async reportCompletion(details: JenkinsBuildDetails): Promise<PanelCompletionDecision> {
    const { environment, currentBuildUrl, currentNonce } = this.state;
    if (
      details.building !== false ||
      !currentBuildUrl ||
      (environment && mismatchedPanelRunUrl(environment, currentBuildUrl, details.number))
    )
      return { disposition: "handled" };
    const target = resolveDisplayedFollowTarget(environment, currentBuildUrl, details);
    const queueId = isBuildQueueId(details.queueId) ? details.queueId : undefined;
    const notice = target && { ...target, queueId, result: details.result };
    const confirmed = this.state.confirmedCompletion(details);
    if (!confirmed) return this.claimSubscription(details, notice);
    const completedUrl =
      target?.buildUrl ?? resolveDisplayedRun(environment, currentBuildUrl, details)?.buildUrl;
    const presentation = this.state.completionPresentation(details);
    const decision =
      this.tracker && notice
        ? await this.tracker.claimPanelCompletion({
            notice,
            previouslyDelivered: presentation.previouslyDelivered
          })
        : { disposition: "panel" as const };
    if (decision.disposition !== "panel") return decision;
    if (presentation.previouslyDelivered) return { disposition: "handled" };

    const sameLoad = this.state.currentNonce === currentNonce;
    const current = this.confirmForDelivery(details, confirmed, sameLoad, notice, decision);
    if (!current) return { disposition: "handled" };

    return this.deliverCompletion(
      details,
      current,
      completedUrl,
      presentation,
      decision,
      notice,
      sameLoad
    );
  }

  private async deliverCompletion(
    details: JenkinsBuildDetails,
    current: JenkinsBuildDetails,
    completedUrl: string | undefined,
    presentation: ReturnType<BuildDetailsPanelState["completionPresentation"]>,
    decision: Extract<PanelCompletionDecision, { disposition: "panel" }>,
    notice: FollowedBuildCompletion | undefined,
    sameLoad: boolean
  ): Promise<PanelCompletionDecision> {
    // Publish only once the panel has actually displayed the notice. Waiting for the
    // user's selection would let subsequent observations claim the same result again.
    const shown = current.result === undefined && details.result !== undefined ? details : current;
    const receipt = presentation.presentOnce(() => this.present(shown, completedUrl));
    if (!receipt) return { disposition: "handled" };
    if (notice) {
      const delivered = { ...notice, result: shown.result, noticeOrder: receipt.noticeOrder };
      if (sameLoad)
        this.state.recordFollowedBuildCompletion(delivered, decision.verifiedRunningQueueId);
      this.tracker?.recordPanelCompletion(delivered, decision);
    }
    await receipt.shown;
    return decision;
  }

  private confirmForDelivery(
    details: JenkinsBuildDetails,
    confirmed: JenkinsBuildDetails,
    sameLoad: boolean,
    notice: FollowedBuildCompletion | undefined,
    decision: Extract<PanelCompletionDecision, { disposition: "panel" }>
  ): JenkinsBuildDetails | undefined {
    // Verification can publish a result while the panel waits. A confirmed queue ID
    // can match that notice; an anonymous observation may be a distinct, older run.
    if (!sameLoad) return confirmed;
    const current = this.state.confirmedCompletion(details);
    if (!current) return undefined;
    if (
      notice &&
      (notice.queueId !== undefined || decision.verification === "inconclusive") &&
      this.state.hasCompletionNotice(current)
    )
      return undefined;
    return current;
  }
}
