import type {
  JenkinsCoverageOverview,
  JenkinsModifiedCoverageFile
} from "../../jenkins/coverage/JenkinsCoverageTypes";
import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { PipelineRun } from "../../jenkins/pipeline/PipelineTypes";
import {
  isJenkinsBuildPermalink,
  type JenkinsBuildDetails,
  type JenkinsTestReport
} from "../../jenkins/types";
import {
  normalizeJenkinsUrlForComparison,
  resolveBuildIdentityForEnvironment
} from "../../jenkins/urls";
import { nextBuildObservationOrder } from "../../services/buildFollow/BuildFollowObservationOrder";
import type {
  FollowedBuild,
  FollowedBuildCompletion
} from "../../services/buildFollow/BuildFollowTypes";
import { areStringArraysEqual } from "../../shared/arrays";
import {
  buildResultsCompatible,
  isBuildQueueId,
  requestStartedAfterNotice
} from "../../shared/build/BuildCompletionEvidence";
import type {
  BuildDetailsInitialState,
  BuildDetailsStatusChange
} from "./BuildDetailsPollingController";
import {
  type PanelRunTarget,
  requestedPanelRun,
  resolveDisplayedRun,
  resolvePanelRunTarget
} from "./BuildDetailsRunIdentity";
import type { PipelineNodeLogViewModel } from "./shared/BuildDetailsContracts";

export type PipelineRestartAvailability = "unknown" | "supported" | "unsupported";

interface ProvisionalCompletion {
  urls: Set<string>;
  result?: string;
  noticeOrder: number;
  verifiedRunningQueueId?: number;
}

// A backend can return the same cached object to multiple requests. Give each panel
// response its own snapshot so a delayed callback keeps the order of its original read.
const requestOrders = new WeakMap<JenkinsBuildDetails, number>();

export function getPanelBuildRequestOrder(details: JenkinsBuildDetails): number | undefined {
  return requestOrders.get(details);
}

export async function readPanelBuildDetails(
  read: () => Promise<JenkinsBuildDetails>
): Promise<JenkinsBuildDetails> {
  const order = nextBuildObservationOrder();
  const details = { ...(await read()) };
  requestOrders.set(details, order);
  return details;
}

export function resolveDisplayedFollowTarget(
  environment: JenkinsEnvironmentRef | undefined,
  panelUrl: string | undefined,
  details: JenkinsBuildDetails | undefined,
  purpose: "request" | "comparison" = "request"
): FollowedBuild | undefined {
  if (!environment || !panelUrl || !details || details.number <= 0) return undefined;
  const identity = resolveDisplayedRun(environment, panelUrl, details, purpose);
  if (!identity) return undefined;
  const requestOrder = requestOrders.get(details);
  return {
    environment,
    ...identity,
    observedUrl: normalizeJenkinsUrlForComparison(panelUrl, environment.url),
    ...(requestOrder !== undefined && { requestOrder }),
    label: details.fullDisplayName ?? details.displayName ?? identity.label
  };
}

export class BuildDetailsPanelState {
  private environmentValue: JenkinsEnvironmentRef | undefined;
  private currentBuildUrlValue: string | undefined;
  private currentDetailsValue: JenkinsBuildDetails | undefined;
  private followTargetTokenValue = 1;
  private followTargetUrl?: string;
  private followTargetQueueId?: number;
  private runTargetValue: PanelRunTarget | undefined;
  private completionTransition?: {
    first: JenkinsBuildDetails;
    confirmation?: JenkinsBuildDetails;
  };
  private currentTestReportValue: JenkinsTestReport | undefined;
  private currentCoverageOverviewValue: JenkinsCoverageOverview | undefined;
  private currentModifiedCoverageFilesValue: JenkinsModifiedCoverageFile[] | undefined;
  private currentCoverageActionPathValue: string | undefined;
  private currentCoverageErrorValue: string | undefined;
  private currentPipelineRunValue: PipelineRun | undefined;
  private currentErrorsValue: string[] = [];
  private baseErrorsValue: string[] = [];
  private pipelineErrorValue: string | undefined;
  private currentPendingInputsValue: PendingInputAction[] = [];
  private testReportFetchedValue = false;
  private testReportLogsIncludedValue = false;
  private testResultsLoadingValue = false;
  private coverageFetchedValue = false;
  private coverageLoadingValue = false;
  private pipelineRestartAvailabilityValue: PipelineRestartAvailability = "unknown";
  private pipelineRestartEnabledValue = false;
  private pipelineRestartableStagesValue: string[] = [];
  private followLogValue = true;
  private readonly notifiedRuns = new Map<string | number, Map<number, number>>();
  private readonly provisionalCompletions = new Set<ProvisionalCompletion>();
  private readonly notifiedQueueRuns = new Map<string, { result?: string; noticeOrder: number }>();
  private panelResults = new Map<string, number>();
  // At a reused URL, a running response without an ID supersedes only the notices
  // that preceded its request. A later response carrying an ID can still match that exact run.
  private readonly runningRequestOrders = new Map<
    string | number,
    Map<number | undefined, number>
  >();
  private lastObservedQueue:
    | { run: string | number; id: number; terminal: boolean; requestOrder?: number }
    | undefined;
  private currentNonceValue = "";
  private pipelineLoadingValue = false;
  private pipelineNodeLogValue: PipelineNodeLogViewModel = createEmptyPipelineNodeLog();

  get environment(): JenkinsEnvironmentRef | undefined {
    return this.environmentValue;
  }

  get currentBuildUrl(): string | undefined {
    return this.currentBuildUrlValue;
  }

  get currentDetails(): JenkinsBuildDetails | undefined {
    return this.currentDetailsValue;
  }

  get terminalRun(): PanelRunTarget | undefined {
    return this.currentDetailsValue?.building === false ? this.runTargetValue : undefined;
  }

  get runTarget(): PanelRunTarget | undefined {
    return this.runTargetValue;
  }

  get currentTestReport(): JenkinsTestReport | undefined {
    return this.currentTestReportValue;
  }

  get currentCoverageOverview(): JenkinsCoverageOverview | undefined {
    return this.currentCoverageOverviewValue;
  }

  get currentModifiedCoverageFiles(): JenkinsModifiedCoverageFile[] | undefined {
    return this.currentModifiedCoverageFilesValue;
  }

  get currentCoverageError(): string | undefined {
    return this.currentCoverageErrorValue;
  }

  get currentCoverageActionPath(): string | undefined {
    return this.currentCoverageActionPathValue;
  }

  get currentPipelineRun(): PipelineRun | undefined {
    return this.currentPipelineRunValue;
  }

  get currentErrors(): string[] {
    return this.currentErrorsValue;
  }

  get currentPendingInputs(): PendingInputAction[] {
    return this.currentPendingInputsValue;
  }

  get testReportFetched(): boolean {
    return this.testReportFetchedValue;
  }

  get testReportLogsIncluded(): boolean {
    return this.testReportLogsIncludedValue;
  }

  get testResultsLoading(): boolean {
    return this.testResultsLoadingValue;
  }

  get coverageFetched(): boolean {
    return this.coverageFetchedValue;
  }

  get coverageLoading(): boolean {
    return this.coverageLoadingValue;
  }

  get pipelineRestartAvailability(): PipelineRestartAvailability {
    return this.pipelineRestartAvailabilityValue;
  }

  get pipelineRestartEnabled(): boolean {
    return this.pipelineRestartEnabledValue;
  }

  get pipelineRestartableStages(): string[] {
    return this.pipelineRestartableStagesValue;
  }

  get followLog(): boolean {
    return this.followLogValue;
  }

  get currentNonce(): string {
    return this.currentNonceValue;
  }

  get needsStatusPolling(): boolean {
    return this.currentDetailsValue !== undefined && this.currentDetailsValue.building !== false;
  }

  get pipelineLoading(): boolean {
    return this.pipelineLoadingValue;
  }

  get pipelineNodeLog(): PipelineNodeLogViewModel {
    return this.pipelineNodeLogValue;
  }

  resetForLoad(environment: JenkinsEnvironmentRef, buildUrl: string, nonce: string): void {
    this.environmentValue = environment;
    this.currentBuildUrlValue = buildUrl;
    this.setCurrentDetails(undefined);
    this.runTargetValue = undefined;
    this.completionTransition = undefined;
    this.resetTerminalData();
    this.currentPipelineRunValue = undefined;
    this.currentErrorsValue = [];
    this.baseErrorsValue = [];
    this.pipelineErrorValue = undefined;
    this.currentPendingInputsValue = [];
    this.notifiedRuns.clear();
    this.provisionalCompletions.clear();
    this.notifiedQueueRuns.clear();
    this.panelResults = new Map();
    this.runningRequestOrders.clear();
    this.lastObservedQueue = undefined;
    this.currentNonceValue = nonce;
    this.pipelineLoadingValue = true;
    this.pipelineNodeLogValue = createEmptyPipelineNodeLog();
  }

  applyInitialState(
    initialState: BuildDetailsInitialState,
    pipelineRun: PipelineRun | undefined,
    pipelineError: string | undefined
  ): boolean {
    if (
      this.currentDetailsValue &&
      (!initialState.details ||
        !requestOrders.has(initialState.details) ||
        this.hasNewerDisplayedDetails(initialState.details))
    )
      return false;
    this.completionTransition = undefined;
    this.setCurrentDetails(initialState.details);
    this.runTargetValue =
      "runTarget" in initialState
        ? initialState.runTarget
        : resolvePanelRunTarget(
            this.environmentValue,
            this.currentBuildUrlValue,
            initialState.details
          );
    this.resetTerminalData();
    this.currentPipelineRunValue = pipelineRun;
    this.baseErrorsValue = initialState.errors;
    this.pipelineErrorValue = pipelineError;
    this.currentPendingInputsValue = initialState.pendingInputs ?? [];
    this.pipelineLoadingValue = false;
    this.currentErrorsValue = composeErrors(this.baseErrorsValue, this.pipelineErrorValue);
    return true;
  }

  hasNewerDisplayedDetails(details: JenkinsBuildDetails): boolean {
    const order = requestOrders.get(details);
    const displayed = this.currentDetailsValue && requestOrders.get(this.currentDetailsValue);
    return order !== undefined && displayed !== undefined && order < displayed;
  }

  /** A newer terminal read can corroborate an accepted transition while its workflow request settles. */
  confirmedCompletion(details: JenkinsBuildDetails): JenkinsBuildDetails | undefined {
    if (!this.hasNewerDisplayedDetails(details)) return details;
    const transition = this.completionTransition;
    return transition?.first === details ? transition.confirmation : undefined;
  }

  updateDetails(details: JenkinsBuildDetails): BuildDetailsStatusChange {
    if (this.hasNewerDisplayedDetails(details)) {
      return {
        superseded: true,
        building: this.currentDetailsValue?.building,
        firstTerminal: false,
        completedNow: false
      };
    }
    const previous = this.currentDetailsValue;
    const prior = this.runTargetValue;
    const priorTerminal = this.terminalRun;
    const lastBuilding =
      previous && this.sameDisplayedRun(previous, details) ? previous.building : undefined;
    this.applyDisplayedDetails(details, lastBuilding);
    const targetChanged = this.updateRunTarget(previous, prior, priorTerminal);
    const terminal = this.terminalRun;
    const firstTerminal =
      details.building === false && (lastBuilding !== false || terminal !== priorTerminal);
    const completedNow = lastBuilding === true && details.building === false;
    this.updateCompletionTransition(details, terminal, priorTerminal, completedNow);
    return {
      building: this.currentDetailsValue?.building,
      firstTerminal,
      completedNow,
      targetChanged
    };
  }

  private applyDisplayedDetails(
    details: JenkinsBuildDetails,
    lastBuilding: boolean | undefined
  ): void {
    // Keep the last confirmed status in the presentation. Callers still pass the raw
    // response to the tracker, so a partial read supplies no new running evidence.
    if (typeof details.building !== "boolean" && typeof lastBuilding === "boolean") {
      const displayed = { ...details, building: lastBuilding };
      const order = requestOrders.get(details);
      if (order !== undefined) requestOrders.set(displayed, order);
      this.setCurrentDetails(displayed);
    } else {
      this.setCurrentDetails(details);
    }
  }

  private updateRunTarget(
    previous: JenkinsBuildDetails | undefined,
    prior: PanelRunTarget | undefined,
    priorTerminal: PanelRunTarget | undefined
  ): boolean {
    const observed = resolvePanelRunTarget(
      this.environmentValue,
      this.currentBuildUrlValue,
      this.currentDetailsValue
    );
    const sameRun =
      observed &&
      prior &&
      observed.buildUrl === prior.buildUrl &&
      observed.buildNumber === prior.buildNumber &&
      (observed.queueId === undefined || observed.queueId === prior.queueId) &&
      buildResultsCompatible(prior.result, observed.result);
    const samePhase =
      (previous?.building === false) === (this.currentDetailsValue?.building === false);
    if (sameRun && samePhase) prior.result ??= observed.result;
    else this.runTargetValue = observed;
    const targetChanged = prior !== this.runTargetValue;
    const terminal = this.terminalRun;
    if (priorTerminal && terminal !== priorTerminal) this.resetTerminalData();
    if (prior && targetChanged && (!sameRun || priorTerminal)) {
      this.currentPipelineRunValue = undefined;
      this.pipelineLoadingValue = false;
      this.pipelineErrorValue = undefined;
      this.currentErrorsValue = composeErrors(this.baseErrorsValue, this.pipelineErrorValue);
    }
    return targetChanged;
  }

  private updateCompletionTransition(
    details: JenkinsBuildDetails,
    terminal: PanelRunTarget | undefined,
    priorTerminal: PanelRunTarget | undefined,
    completedNow: boolean
  ): void {
    if (terminal !== priorTerminal) this.completionTransition = undefined;
    if (completedNow && terminal && isBuildQueueId(details.queueId))
      this.completionTransition = { first: details };
    const transition = this.completionTransition;
    if (transition) {
      transition.confirmation =
        details.building === false && details.queueId === transition.first.queueId
          ? details
          : undefined;
    }
  }

  private resetTerminalData(): void {
    this.currentTestReportValue = undefined;
    this.testReportFetchedValue = false;
    this.testReportLogsIncludedValue = false;
    this.testResultsLoadingValue = false;
    this.resetCoverage();
    this.pipelineRestartAvailabilityValue = "unknown";
    this.pipelineRestartEnabledValue = false;
    this.pipelineRestartableStagesValue = [];
  }

  private sameDisplayedRun(previous: JenkinsBuildDetails, current: JenkinsBuildDetails): boolean {
    if (!Number.isSafeInteger(current.number) || previous.number !== current.number) return false;
    const previousKey = this.completionKey(previous);
    const priorId = positiveQueueId(previous.queueId) ?? this.knownQueueId(previousKey);
    if (priorId !== undefined && isBuildQueueId(current.queueId))
      return priorId === current.queueId;
    return previousKey === this.completionKey(current);
  }

  /** Only a running response requested after a notice can disprove that run's completion. */
  async readBuildDetails(read: () => Promise<JenkinsBuildDetails>): Promise<JenkinsBuildDetails> {
    const nonce = this.currentNonceValue;
    const environment = this.environmentValue;
    const url = this.currentBuildUrlValue;
    const details = await readPanelBuildDetails(read);
    const requestOrder = requestOrders.get(details);
    if (requestOrder === undefined || !details.building || this.currentNonceValue !== nonce)
      return details;
    const run = resolveDisplayedFollowTarget(environment, url, details, "comparison");
    if (!run) return details;
    const id = positiveQueueId(details.queueId);
    let orders = this.runningRequestOrders.get(run.buildUrl);
    if (!orders) {
      orders = new Map();
      this.runningRequestOrders.set(run.buildUrl, orders);
    }
    orders.set(id, Math.max(orders.get(id) ?? 0, requestOrder));
    return details;
  }

  private setCurrentDetails(details: JenkinsBuildDetails | undefined): void {
    this.currentDetailsValue = details;
    if (details) this.rememberDisplayedQueue(details);
    const target = details?.building
      ? resolveDisplayedFollowTarget(this.environmentValue, this.currentBuildUrlValue, details)
      : undefined;
    const queueId = target && positiveQueueId(this.currentDetailsValue?.queueId);
    if (target?.buildUrl !== this.followTargetUrl || queueId !== this.followTargetQueueId) {
      this.followTargetUrl = target?.buildUrl;
      this.followTargetQueueId = queueId;
      this.followTargetTokenValue++;
    }
  }

  get followTargetToken(): number {
    return this.followTargetTokenValue;
  }

  private rememberDisplayedQueue(details: JenkinsBuildDetails): void {
    const id = positiveQueueId(details.queueId);
    const run = this.completionKey(details);
    const prior = this.lastObservedQueue;
    if (id !== undefined) {
      const sameQueue = prior?.run === run && prior.id === id;
      this.lastObservedQueue = {
        run,
        id,
        terminal:
          details.building === false ||
          (details.building === undefined && sameQueue && prior.terminal),
        requestOrder: requestOrders.get(details)
      };
      this.hasCompletionNotice(details);
      return;
    }
    if (prior?.run === run) this.inheritDisplayedQueue(details, run, prior);
  }

  private inheritDisplayedQueue(
    details: JenkinsBuildDetails,
    run: string | number,
    prior: { terminal: boolean }
  ): void {
    if (details.building === false) prior.terminal = true;
    if (details.building !== true) return;
    // A completed Jenkins run cannot start running again. This URL now needs fresh queue evidence.
    if (prior.terminal) {
      this.lastObservedQueue = undefined;
      return;
    }
    const known = this.knownQueueId(run);
    if (known !== undefined) {
      this.currentDetailsValue = { ...details, queueId: known };
      const order = requestOrders.get(details);
      if (order !== undefined) requestOrders.set(this.currentDetailsValue, order);
    }
  }

  setTestReport(
    testReport: JenkinsTestReport | undefined,
    options?: { logsIncluded?: boolean }
  ): void {
    this.currentTestReportValue = testReport;
    this.testReportFetchedValue = true;
    this.testReportLogsIncludedValue = Boolean(options?.logsIncluded);
  }

  markTestReportFetchAttempted(): void {
    this.testReportFetchedValue = true;
  }

  setTestResultsLoading(value: boolean): boolean {
    if (this.testResultsLoadingValue === value) {
      return false;
    }
    this.testResultsLoadingValue = value;
    return true;
  }

  setCoverage(
    overview: JenkinsCoverageOverview | undefined,
    modifiedFiles: JenkinsModifiedCoverageFile[] | undefined
  ): void {
    this.currentCoverageOverviewValue = overview;
    this.currentModifiedCoverageFilesValue = modifiedFiles;
    this.currentCoverageErrorValue = undefined;
    this.coverageFetchedValue = true;
  }

  setCoverageActionPath(actionPath: string | undefined): boolean {
    const normalized = actionPath?.trim() || undefined;
    if (this.currentCoverageActionPathValue === normalized) {
      return false;
    }
    this.currentCoverageActionPathValue = normalized;
    return true;
  }

  setCoverageError(error: string): void {
    this.currentCoverageOverviewValue = undefined;
    this.currentModifiedCoverageFilesValue = undefined;
    this.currentCoverageErrorValue = error;
    this.coverageFetchedValue = true;
  }

  resetCoverage(): void {
    this.currentCoverageOverviewValue = undefined;
    this.currentModifiedCoverageFilesValue = undefined;
    this.currentCoverageActionPathValue = undefined;
    this.currentCoverageErrorValue = undefined;
    this.coverageFetchedValue = false;
    this.coverageLoadingValue = false;
  }

  setCoverageLoading(value: boolean): boolean {
    if (this.coverageLoadingValue === value) {
      return false;
    }
    this.coverageLoadingValue = value;
    return true;
  }

  setPipelineRun(pipelineRun: PipelineRun | undefined): void {
    this.currentPipelineRunValue = pipelineRun;
    this.pipelineErrorValue = undefined;
    this.pipelineLoadingValue = false;
  }

  setPipelineError(pipelineError: string | undefined): void {
    this.pipelineErrorValue = pipelineError;
    this.pipelineLoadingValue = false;
  }

  setConsoleReadError(error: string | undefined): void {
    this.removeBaseErrors((message) => message.startsWith("Console output: "));
    if (error) this.baseErrorsValue.push(`Console output: ${error}`);
  }

  setBaseErrors(errors: string[]): void {
    this.baseErrorsValue = errors;
  }

  removeBaseErrors(predicate: (error: string) => boolean): void {
    this.baseErrorsValue = this.baseErrorsValue.filter((error) => !predicate(error));
  }

  setPipelineLoading(value: boolean): boolean {
    if (this.pipelineLoadingValue === value) {
      return false;
    }
    this.pipelineLoadingValue = value;
    return true;
  }

  setPipelineNodeLog(log: PipelineNodeLogViewModel): void {
    this.pipelineNodeLogValue = log;
  }

  clearPipelineNodeLog(): void {
    this.pipelineNodeLogValue = createEmptyPipelineNodeLog();
  }

  setPendingInputs(pendingInputs: PendingInputAction[]): void {
    this.currentPendingInputsValue = pendingInputs;
  }

  setPipelineRestartInfo(
    restartEnabled: boolean,
    restartableStages: string[],
    availability: PipelineRestartAvailability
  ): boolean {
    const normalizedStages = [...new Set(restartableStages.filter((stage) => stage.trim()))];
    const availabilityChanged = this.pipelineRestartAvailabilityValue !== availability;
    const restartEnabledChanged = this.pipelineRestartEnabledValue !== restartEnabled;
    const stagesChanged = !areStringArraysEqual(
      normalizedStages,
      this.pipelineRestartableStagesValue
    );
    if (!availabilityChanged && !restartEnabledChanged && !stagesChanged) {
      return false;
    }
    this.pipelineRestartAvailabilityValue = availability;
    this.pipelineRestartEnabledValue = restartEnabled;
    this.pipelineRestartableStagesValue = normalizedStages;
    return true;
  }

  setFollowLog(value: boolean): void {
    this.followLogValue = value;
  }

  /** A permalink can start displaying this run after the tracker has already notified. */
  recordFollowedBuildCompletion(
    build: FollowedBuildCompletion,
    verifiedRunningQueueId?: number
  ): void {
    const environment = this.environmentValue;
    if (
      !environment ||
      environment.scope !== build.environment.scope ||
      environment.environmentId !== build.environment.environmentId ||
      normalizeJenkinsUrlForComparison(environment.url) !==
        normalizeJenkinsUrlForComparison(build.environment.url)
    ) {
      return;
    }
    const queueId = positiveQueueId(build.queueId);
    const noticeOrder = build.noticeOrder ?? nextBuildObservationOrder();
    if (queueId !== undefined)
      this.rememberDisplayedQueueResult(environment, build, queueId, noticeOrder);
    // An unresolved panel can only match the event after details load. Its URLs remain distinct
    // until this load ends; a recognized target admits only completions for its own job or run.
    const urls = new Set<string>();
    for (const url of [build.buildUrl, ...(build.aliases ?? [])]) {
      const requested = requestedPanelRun(
        environment.url,
        this.currentBuildUrlValue,
        build.buildNumber,
        "comparison",
        url
      );
      const completed = resolveBuildIdentityForEnvironment(
        environment.url,
        url,
        "comparison",
        build,
        "configured"
      );
      if (completed && (!requested || requested.buildUrl === completed.buildUrl))
        urls.add(completed.buildUrl);
    }
    if (queueId === undefined) {
      if (urls.size > 0)
        this.provisionalCompletions.add({
          urls,
          result: build.result,
          noticeOrder,
          verifiedRunningQueueId
        });
      return;
    }
    for (const url of urls) {
      this.recordNotice(url, build.buildNumber, queueId, build.result, noticeOrder);
      this.matchProvisionalCompletion(url, build.result, build.buildNumber, queueId);
    }
  }

  private rememberDisplayedQueueResult(
    environment: JenkinsEnvironmentRef,
    build: FollowedBuildCompletion,
    queueId: number,
    noticeOrder: number
  ): void {
    const details = this.currentDetailsValue;
    const selector =
      this.currentBuildUrlValue &&
      normalizeJenkinsUrlForComparison(this.currentBuildUrlValue, environment.url)
        .split("/")
        .at(-2);
    if (
      !details ||
      (selector && isJenkinsBuildPermalink(selector)) ||
      (details.number === build.buildNumber &&
        (details.queueId === undefined || details.queueId === build.queueId))
    ) {
      this.rememberQueueResult(queueId, build.buildNumber, build.result, noticeOrder);
    }
  }

  getRunningFollowTarget(): FollowedBuild | undefined {
    const details = this.currentDetailsValue;
    if (!details?.building || this.hasCompletionNotice(details)) {
      return undefined;
    }
    const target = resolveDisplayedFollowTarget(
      this.environmentValue,
      this.currentBuildUrlValue,
      details
    );
    const id = positiveQueueId(details.queueId);
    if (!target || id === undefined) return target;
    // This may be a newer display snapshot that inherited an ID from an older response.
    // Cached actions can cite only the request that actually supplied that ID.
    if (this.lastObservedQueue?.requestOrder !== undefined)
      target.requestOrder = this.lastObservedQueue.requestOrder;
    else delete target.requestOrder;
    return { ...target, queueId: id };
  }

  private completionKey(details: JenkinsBuildDetails): string | number {
    const run = resolveDisplayedFollowTarget(
      this.environmentValue,
      this.currentBuildUrlValue,
      details,
      "comparison"
    );
    return run?.buildUrl ?? details.number;
  }

  private knownQueueId(key: string | number): number | undefined {
    if (this.lastObservedQueue?.run !== key) return undefined;
    const id = this.lastObservedQueue.id;
    const cutoff = this.runningRequestOrders.get(key)?.get(undefined);
    if (cutoff !== undefined) {
      const confirmed = this.notifiedRuns.get(key)?.get(id);
      if (confirmed !== undefined && confirmed <= cutoff) return undefined;
      if (typeof key === "string") {
        for (const notice of this.provisionalCompletions) {
          if (
            notice.noticeOrder <= cutoff &&
            notice.urls.has(key) &&
            !this.runningAfterNotice(key, id, notice)
          )
            return undefined;
        }
      }
    }
    return id;
  }

  private runningAfterNotice(key: string, id: number, notice: ProvisionalCompletion): boolean {
    return (
      id === notice.verifiedRunningQueueId ||
      requestStartedAfterNotice(this.runningRequestOrders.get(key)?.get(id), notice.noticeOrder)
    );
  }

  private rememberQueueResult(
    queueId: number,
    buildNumber: number,
    result: string | undefined,
    noticeOrder: number
  ): void {
    const key = `${queueId}:${buildNumber}`;
    const prior = this.notifiedQueueRuns.get(key);
    this.notifiedQueueRuns.set(key, {
      result: prior?.result ?? result,
      noticeOrder: Math.min(prior?.noticeOrder ?? noticeOrder, noticeOrder)
    });
  }

  private recordNotice(
    key: string | number,
    buildNumber: number,
    queueId: number,
    result: string | undefined,
    noticeOrder: number
  ): void {
    let ids = this.notifiedRuns.get(key);
    if (!ids) {
      ids = new Map();
      this.notifiedRuns.set(key, ids);
    }
    ids.set(queueId, Math.min(ids.get(queueId) ?? noticeOrder, noticeOrder));
    this.rememberQueueResult(queueId, buildNumber, result, noticeOrder);
  }

  private matchProvisionalCompletion(
    key: string | number,
    result: string | undefined,
    buildNumber: number,
    queueId: number | undefined,
    displayedId = queueId
  ): boolean {
    if (typeof key !== "string" || (queueId !== undefined && result === undefined)) return false;
    const cutoff = this.runningRequestOrders.get(key)?.get(undefined) ?? 0;
    // A provisional URL-only result needs the same outcome to corroborate a later identity.
    for (const notice of this.provisionalCompletions) {
      if (!notice.urls.has(key) || notice.result !== result || notice.noticeOrder <= cutoff)
        continue;
      if (displayedId !== undefined && this.runningAfterNotice(key, displayedId, notice)) continue;
      if (queueId !== undefined) this.confirmProvisionalCompletion(notice, buildNumber, queueId);
      return true;
    }
    return false;
  }

  private confirmProvisionalCompletion(
    notice: ProvisionalCompletion,
    buildNumber: number,
    queueId: number
  ): void {
    this.provisionalCompletions.delete(notice);
    for (const url of notice.urls)
      this.recordNotice(url, buildNumber, queueId, notice.result, notice.noticeOrder);
  }

  hasCompletionNotice(details: JenkinsBuildDetails): boolean {
    if (
      !this.notifiedRuns.size &&
      !this.notifiedQueueRuns.size &&
      !this.provisionalCompletions.size
    )
      return false;
    const key = this.completionKey(details);
    const reportedId = positiveQueueId(details.queueId);
    const id = reportedId ?? this.knownQueueId(key);
    const cutoff = this.runningRequestOrders.get(key)?.get(undefined) ?? 0;
    if (this.hasQueueCompletionNotice(details, key, reportedId, id, cutoff)) return true;
    if (details.building === false) {
      return this.matchProvisionalCompletion(key, details.result, details.number, reportedId, id);
    }
    // Without a queue ID the header still uses its exact numbered URL to hide a stale button.
    if (id === undefined && typeof key === "string") {
      for (const notice of this.provisionalCompletions) {
        if (notice.urls.has(key) && notice.noticeOrder > cutoff) return true;
      }
    }
    return false;
  }

  private hasQueueCompletionNotice(
    details: JenkinsBuildDetails,
    key: string | number,
    reportedId: number | undefined,
    id: number | undefined,
    cutoff: number
  ): boolean {
    const ids = this.notifiedRuns.get(key);
    // Only the response's own queue ID can establish its identity across different outcomes.
    const matchesOutcome = (queueId: number) => {
      const priorResult = this.notifiedQueueRuns.get(`${queueId}:${details.number}`)?.result;
      return (
        reportedId !== undefined ||
        details.building !== false ||
        buildResultsCompatible(priorResult, details.result)
      );
    };
    if (id === undefined && ids) {
      for (const [queueId, noticeOrder] of ids) {
        if (noticeOrder > cutoff && matchesOutcome(queueId)) return true;
      }
    }
    const known =
      id === undefined ? undefined : this.notifiedQueueRuns.get(`${id}:${details.number}`);
    if (id !== undefined && known && matchesOutcome(id)) {
      // Keep the corroborated pair for a later refresh that omits either piece of evidence.
      this.recordNotice(
        key,
        details.number,
        id,
        reportedId !== undefined && details.building === false ? details.result : undefined,
        known.noticeOrder
      );
      return true;
    }
    return false;
  }

  /** Capture this load's receipts before asynchronous arbitration. Only showing a message writes one. */
  completionPresentation(details: JenkinsBuildDetails): {
    previouslyDelivered: boolean;
    presentOnce(
      show: () => Promise<void>
    ): { shown: Promise<void>; noticeOrder: number } | undefined;
  } {
    const loadReceipts = this.panelResults;
    const delivered = this.hasCompletionNotice(details);
    const key = this.completionKey(details);
    const queueId = positiveQueueId(details.queueId);
    // A terminal response without a queue ID may belong to an older run at this URL.
    // Deduplicate the panel message without marking the displayed queue ID as finished.
    const panelResult = JSON.stringify([
      key,
      queueId,
      queueId ?? this.knownQueueId(key),
      details.result
    ]);
    const cutoff = this.runningRequestOrders.get(key)?.get(undefined) ?? 0;
    const wasPresented = () => (loadReceipts.get(panelResult) ?? 0) > cutoff;
    return {
      previouslyDelivered: delivered || wasPresented(),
      presentOnce(show) {
        if (delivered || wasPresented()) return undefined;
        const shown = show();
        const noticeOrder = nextBuildObservationOrder();
        loadReceipts.set(panelResult, noticeOrder);
        return { shown, noticeOrder };
      }
    };
  }

  updateErrors(): string[] | undefined {
    const nextErrors = composeErrors(this.baseErrorsValue, this.pipelineErrorValue);
    if (!areStringArraysEqual(nextErrors, this.currentErrorsValue)) {
      this.currentErrorsValue = nextErrors;
      return nextErrors;
    }
    return undefined;
  }
}

function positiveQueueId(id: number | undefined): number | undefined {
  return isBuildQueueId(id) ? id : undefined;
}

function composeErrors(baseErrors: string[], pipelineError?: string): string[] {
  const nextErrors = [...baseErrors];
  if (pipelineError && !nextErrors.includes(pipelineError)) {
    nextErrors.push(pipelineError);
  }
  return nextErrors;
}

function createEmptyPipelineNodeLog(): PipelineNodeLogViewModel {
  return {
    text: "",
    truncated: false,
    loading: false
  };
}
