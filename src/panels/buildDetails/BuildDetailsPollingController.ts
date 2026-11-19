import type { PendingInputAction } from "../../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type { JenkinsTestReportOptions } from "../../jenkins/JenkinsTestReportOptions";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleTextTail,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../../jenkins/types";
import type {
  BuildDetailsConsoleBackend,
  BuildDetailsPendingInputProvider,
  BuildDetailsPendingInputsBackend,
  BuildDetailsStatusBackend,
  BuildDetailsTestsBackend
} from "./BuildDetailsBackend";
import { BuildDetailsRunConsole } from "./BuildDetailsRunConsole";
import { type PanelRunTarget, resolvePanelRunTarget } from "./BuildDetailsRunIdentity";
import type {
  ConsoleSnapshotResult,
  ConsoleStreamManager,
  ConsoleTextByteRange
} from "./ConsoleStreamManager";

export interface BuildDetailsStatusChange {
  superseded?: boolean;
  targetChanged?: boolean;
  building: boolean | undefined;
  firstTerminal: boolean;
  completedNow: boolean;
}

export interface BuildDetailsPollingCallbacks {
  getBuilding(): boolean | undefined;
  getRunTarget(): PanelRunTarget | undefined;
  onWorkflowFetchStart?: () => void;
  hasNewerDisplayedDetails?(details: JenkinsBuildDetails): boolean;
  onDetails(details: JenkinsBuildDetails): BuildDetailsStatusChange | undefined;
  onWorkflowRun(workflowRun: JenkinsWorkflowRun | undefined): void;
  onWorkflowError(error: unknown): void;
  onPendingInputs(pendingInputs: PendingInputAction[]): void;
  onTitle(title: string): void;
  onConsoleAppend(text: string): void;
  onConsoleSet(payload: { text: string; truncated: boolean }): void;
  onConsoleHtmlAppend(
    html: string,
    textRange: ConsoleTextByteRange,
    appendedTextRange: ConsoleTextByteRange
  ): void;
  onConsoleHtmlSet(payload: {
    html: string;
    truncated: boolean;
    textRange: ConsoleTextByteRange;
  }): void;
  onErrors(errors: string[], preserveConsoleError?: boolean): void;
  onComplete(details: JenkinsBuildDetails): void;
}

export interface BuildDetailsPollingOptions {
  waitForWebviewReady?: boolean;
  statusBackend: BuildDetailsStatusBackend;
  testsBackend: BuildDetailsTestsBackend;
  consoleBackend: BuildDetailsConsoleBackend;
  pendingInputsBackend: BuildDetailsPendingInputsBackend;
  pendingInputProvider?: BuildDetailsPendingInputProvider;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  maxConsoleChars: number;
  getRefreshIntervalMs: () => number;
  testReportOptions?: JenkinsTestReportOptions;
  callbacks: BuildDetailsPollingCallbacks;
  formatError: (error: unknown) => string;
}

export interface BuildDetailsInitialState {
  details?: JenkinsBuildDetails;
  runTarget?: PanelRunTarget;
  consoleTextResult?: JenkinsConsoleTextTail;
  consoleHtmlResult?: { html: string; truncated: boolean };
  workflowRun?: JenkinsWorkflowRun;
  workflowError?: unknown;
  pendingInputs?: PendingInputAction[];
  errors: string[];
}

export interface BuildDetailsTestReportFetchResult {
  report: JenkinsTestReport | undefined;
  effectiveOptions: JenkinsTestReportOptions | undefined;
}

const WORKFLOW_REFRESH_MULTIPLIER = 3;
const MIN_WORKFLOW_REFRESH_MS = 5000;

export class BuildDetailsPollingController {
  private readonly statusBackend: BuildDetailsStatusBackend;
  private readonly testsBackend: BuildDetailsTestsBackend;
  private readonly pendingInputProvider: BuildDetailsPendingInputProvider;
  private readonly environment: JenkinsEnvironmentRef;
  private readonly buildUrl: string;
  private readonly maxConsoleChars: number;
  private readonly getRefreshIntervalMs: () => number;
  private testReportOptions?: JenkinsTestReportOptions;
  private readonly callbacks: BuildDetailsPollingCallbacks;
  private readonly formatError: (error: unknown) => string;
  private readonly runConsole: BuildDetailsRunConsole;
  private consoleReady: boolean;
  private pollingStream?: ConsoleStreamManager;
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollingActive = false;
  private disposed = false;
  private pollGeneration = 0;
  private lastWorkflowFetchAt = 0;
  private workflowRetryPending = false;
  private lastPendingInputsCount = 0;

  constructor(options: BuildDetailsPollingOptions) {
    this.statusBackend = options.statusBackend;
    this.testsBackend = options.testsBackend;
    this.pendingInputProvider = options.pendingInputProvider ?? options.pendingInputsBackend;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.maxConsoleChars = options.maxConsoleChars;
    this.getRefreshIntervalMs = options.getRefreshIntervalMs;
    this.testReportOptions = options.testReportOptions;
    this.callbacks = options.callbacks;
    this.formatError = options.formatError;
    this.consoleReady = !options.waitForWebviewReady;
    this.runConsole = new BuildDetailsRunConsole({
      dataService: options.consoleBackend,
      environment: this.environment,
      buildUrl: this.buildUrl,
      maxConsoleChars: this.maxConsoleChars,
      callbacks: {
        onConsoleAppend: this.callbacks.onConsoleAppend,
        onConsoleSet: this.callbacks.onConsoleSet,
        onConsoleHtmlAppend: this.callbacks.onConsoleHtmlAppend,
        onConsoleHtmlSet: this.callbacks.onConsoleHtmlSet
      }
    });
  }

  // fallow-ignore-next-line unused-class-member -- invoked through BuildDetailsPanelRuntime's polling-controller lookup
  refreshConsoleSnapshot(use: (snapshot: ConsoleSnapshotResult) => void): Promise<void> {
    // A reveal may refresh the tail before React installs its listener. The ready
    // handshake consumes this same snapshot and its cursors.
    const postSnapshot = this.consoleReady;
    return this.runConsole.withSnapshot((snapshot) => {
      if (postSnapshot && this.consoleReady) use(snapshot);
    }, true);
  }

  get consoleUrl(): string | undefined {
    return this.runConsole.url;
  }

  selectConsoleRun(details?: JenkinsBuildDetails) {
    // A recreated document can re-seed the same numbered run while the poll is
    // waiting for status. Only the stream that produced its chunk can commit it.
    const missedConsole =
      this.pollInFlight && (!this.pollingStream || this.pollingStream !== this.runConsole.stream);
    return this.runConsole.select(details, !this.consoleReady || missedConsole);
  }

  withConsoleSnapshot(
    use: (snapshot: ConsoleSnapshotResult) => void,
    refresh = false
  ): Promise<void> {
    return this.runConsole.withSnapshot(use, refresh);
  }

  get canPostConsole(): boolean {
    return this.consoleReady;
  }

  setConsoleReady(ready: boolean): void {
    this.consoleReady = ready;
  }

  // fallow-ignore-next-line unused-class-member -- invoked through BuildDetailsPanelRuntime's polling-controller lookup
  async fetchTestReport(
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<BuildDetailsTestReportFetchResult> {
    const effectiveOptions = this.resolveTestReportOptions(options);
    const report = await this.testsBackend.getTestReport(
      this.environment,
      buildUrl,
      effectiveOptions
    );
    return { report, effectiveOptions };
  }

  resolveTestReportOptions(
    options?: JenkinsTestReportOptions
  ): JenkinsTestReportOptions | undefined {
    return options ?? this.testReportOptions;
  }

  // fallow-ignore-next-line unused-class-member -- invoked through BuildDetailsPanelRuntime's polling-controller lookup
  async fetchWorkflowRunWithCallbacks(isCurrent: () => boolean): Promise<void> {
    if (this.disposed || !isCurrent()) {
      return;
    }
    const run = this.callbacks.getRunTarget();
    if (!run) return;
    const canApply = () => !this.disposed && isCurrent() && this.callbacks.getRunTarget() === run;
    this.callbacks.onWorkflowFetchStart?.();
    try {
      const workflowRun = await this.statusBackend.getWorkflowRun(
        this.environment,
        run.buildUrl,
        run
      );
      if (!canApply()) return;
      this.callbacks.onWorkflowRun(workflowRun);
      this.workflowRetryPending = false;
    } catch (error) {
      if (!canApply()) return;
      this.callbacks.onWorkflowError(error);
      if (this.callbacks.getBuilding() === false) {
        this.workflowRetryPending = true;
        this.lastWorkflowFetchAt = Date.now();
        this.start();
      }
    }
  }

  // fallow-ignore-next-line unused-class-member -- invoked through BuildDetailsPanelRuntime's polling-controller lookup
  async refreshPendingInputs(): Promise<void> {
    try {
      const pendingInputs = await this.pendingInputProvider.getPendingInputActions(
        this.environment,
        this.buildUrl
      );
      this.lastPendingInputsCount = pendingInputs.length;
      this.callbacks.onPendingInputs(pendingInputs);
    } catch {
      // Swallow failures to keep the panel responsive.
    }
  }

  setTestReportOptions(options?: JenkinsTestReportOptions): void {
    this.testReportOptions = options;
  }

  async loadInitial(initialDetails?: JenkinsBuildDetails): Promise<BuildDetailsInitialState> {
    const read = initialDetails
      ? Promise.resolve(initialDetails)
      : this.statusBackend.getBuildDetails(this.environment, this.buildUrl, {
          includeCauses: true
        });
    const status = read.then((details) => ({
      details,
      runTarget: resolvePanelRunTarget(this.environment, this.buildUrl, details)
    }));
    // Even a numbered URL can be reused. Start the workflow from its identified
    // Run so URL resolution and the unsupported-endpoint cache use the same evidence.
    const workflow = status.then(
      ({ details, runTarget }) =>
        runTarget && !this.disposed && !this.callbacks.hasNewerDisplayedDetails?.(details)
          ? this.statusBackend.getWorkflowRun(this.environment, runTarget.buildUrl, runTarget)
          : undefined,
      () => undefined
    );
    const consoleSnapshotRead = status
      .then(
        ({ details }) => {
          if (!this.callbacks.hasNewerDisplayedDetails?.(details)) this.selectConsoleRun(details);
        },
        () => {}
      )
      .then(async () => {
        let result: ConsoleSnapshotResult | undefined;
        await this.withConsoleSnapshot((snapshot) => {
          result = snapshot;
        });
        return result;
      });
    const [detailsResult, workflowResult, consoleResult, pendingInputsResult] =
      await Promise.allSettled([
        status,
        workflow,
        consoleSnapshotRead,
        this.pendingInputProvider.getPendingInputActions(this.environment, this.buildUrl)
      ]);
    const { value: initial, error: detailsError } = settled(detailsResult);
    const details = initial?.details;
    const { value: workflowRun, error: workflowError } =
      !details || this.callbacks.hasNewerDisplayedDetails?.(details) ? {} : settled(workflowResult);
    const { value: consoleSnapshot, error: consoleRejection } = settled(consoleResult);
    const { value: pendingInputs = [], error: pendingInputsError } = settled(pendingInputsResult);
    if (pendingInputsResult.status === "fulfilled") {
      this.lastPendingInputsCount = pendingInputs.length;
    }

    const consoleTextResult = consoleSnapshot?.consoleTextResult;
    const consoleHtmlResult = consoleSnapshot?.consoleHtmlResult;
    const consoleError = consoleSnapshot?.consoleError || consoleRejection;

    // The initial load shows rendered HTML when available, so a text-tail failure is not an error.
    const errors = this.buildRequestErrors({
      detailsError,
      consoleError: consoleHtmlResult ? undefined : consoleError,
      pendingInputsError
    });

    if (workflowError && details?.building === false) {
      this.workflowRetryPending = true;
    }

    if (workflowRun || workflowError) {
      this.lastWorkflowFetchAt = Date.now();
    }

    return {
      details,
      runTarget: initial?.runTarget,
      consoleTextResult,
      consoleHtmlResult,
      workflowRun,
      workflowError,
      pendingInputs,
      errors
    };
  }

  start(): void {
    if (this.pollingActive || this.disposed) {
      return;
    }
    this.pollingActive = true;
    this.scheduleNextPoll();
  }

  stop(): void {
    this.pollGeneration += 1;
    this.pollingActive = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    // pollInFlight is intentionally left untouched: only the poll that set it
    // may clear it (in its finally), otherwise a stop()/start() cycle while a
    // poll is awaiting would run two polls concurrently against the same
    // ConsoleStreamManager.
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.runConsole.dispose();
  }

  private scheduleNextPoll(): void {
    if (!this.pollingActive || this.pollTimer || this.disposed) {
      return;
    }
    const delay = this.getRefreshIntervalMs();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.poll();
    }, delay);
  }

  private async poll(): Promise<void> {
    if (!this.pollingActive || this.disposed) {
      return;
    }
    if (this.pollInFlight) {
      // A poll from a previous generation is still draining; retry after the
      // regular interval instead of running a second concurrent poll.
      this.scheduleNextPoll();
      return;
    }

    this.pollInFlight = true;
    const pollGeneration = this.pollGeneration;

    try {
      const stream = this.consoleReady ? this.runConsole.stream : undefined;
      this.pollingStream = stream;
      const [detailsResult, consoleFetchResult] = await Promise.allSettled([
        this.statusBackend.getBuildDetails(this.environment, this.buildUrl),
        stream?.fetchNext()
      ]);

      const { value: details, error: detailsError } = settled(detailsResult);
      const { value: consoleResult, error: consoleError } = settled(consoleFetchResult);
      let workflowRun: JenkinsWorkflowRun | undefined;
      let workflowError: unknown;
      let pendingInputs: PendingInputAction[] = [];
      let pendingInputsError: unknown;

      const shouldFetchPendingInputs =
        Boolean(details?.building ?? this.callbacks.getBuilding()) ||
        this.lastPendingInputsCount > 0;
      if (shouldFetchPendingInputs) {
        try {
          pendingInputs = await this.pendingInputProvider.getPendingInputActions(
            this.environment,
            this.buildUrl
          );
        } catch (error) {
          pendingInputsError = error;
        }
      }

      if (!this.isPollCurrent(pollGeneration)) {
        return;
      }
      const consoleFailure = consoleError ?? consoleResult?.error;
      if (consoleFailure || !consoleResult?.value) this.pollingStream = undefined;
      const change = details ? this.callbacks.onDetails(details) : undefined;
      if (change?.superseded) {
        // Console, pending inputs and workflow all belong to the discarded observation.
        if (
          change.building !== false ||
          this.workflowRetryPending ||
          this.runConsole.stream?.shouldContinuePolling()
        )
          this.scheduleNextPoll();
        else this.stop();
        return;
      }

      if (stream && stream === this.runConsole.stream && !consoleFailure && consoleResult?.value) {
        stream.applyResult(consoleResult);
      }
      if (details) {
        const title = details.fullDisplayName ?? details.displayName;
        if (title) {
          this.callbacks.onTitle(title);
        }
      }
      if (!pendingInputsError && shouldFetchPendingInputs) {
        this.lastPendingInputsCount = pendingInputs.length;
        this.callbacks.onPendingInputs(pendingInputs);
      }

      const building = change?.building ?? this.callbacks.getBuilding();
      const completedNow = change?.completedNow === true;

      const shouldFetchWorkflow = this.shouldFetchWorkflow(
        building,
        change?.firstTerminal === true || change?.targetChanged === true
      );
      const run = this.callbacks.getRunTarget();
      const newerStatusDisplayed = () =>
        details && this.callbacks.hasNewerDisplayedDetails?.(details);
      if (!run) this.workflowRetryPending = false;
      if (shouldFetchWorkflow && run) {
        const isCurrent = () =>
          this.isPollCurrent(pollGeneration) && run === this.callbacks.getRunTarget();
        const workflowStart = Date.now();
        this.callbacks.onWorkflowFetchStart?.();
        try {
          workflowRun = await this.statusBackend.getWorkflowRun(
            this.environment,
            run.buildUrl,
            run
          );
          if (!isCurrent()) {
            if (this.isPollCurrent(pollGeneration)) this.scheduleNextPoll();
            this.deliverStaleCompletion(completedNow, details);
            return;
          }
          this.callbacks.onWorkflowRun(workflowRun);
          this.workflowRetryPending = false;
        } catch (error) {
          if (!isCurrent()) {
            if (this.isPollCurrent(pollGeneration)) this.scheduleNextPoll();
            this.deliverStaleCompletion(completedNow, details);
            return;
          }
          workflowError = error;
          this.callbacks.onWorkflowError(workflowError);
          if (building === false) {
            this.workflowRetryPending = true;
          }
        } finally {
          if (isCurrent()) {
            this.lastWorkflowFetchAt = workflowStart;
          }
        }
      }

      const currentConsoleRead = stream !== undefined && stream === this.runConsole.stream;
      const errors = this.buildRequestErrors({
        detailsError,
        consoleError: currentConsoleRead ? consoleFailure : undefined,
        pendingInputsError
      });
      if (!newerStatusDisplayed()) this.callbacks.onErrors(errors, !currentConsoleRead);

      const shouldContinuePolling =
        !details ||
        building !== false ||
        this.workflowRetryPending ||
        this.runConsole.stream?.shouldContinuePolling();
      if (shouldContinuePolling) {
        this.scheduleNextPoll();
      } else {
        this.stop();
      }
      if (completedNow && details) {
        this.callbacks.onComplete(details);
      }
    } finally {
      this.pollingStream = undefined;
      this.pollInFlight = false;
    }
  }

  // onDetails already applied the completion transition before the
  // workflow fetch, so a stop() during that fetch must not swallow the completion callback.
  private deliverStaleCompletion(
    completedNow: boolean,
    details: JenkinsBuildDetails | undefined
  ): void {
    if (completedNow && details && !this.disposed) {
      this.callbacks.onComplete(details);
    }
  }

  private shouldFetchWorkflow(building: boolean | undefined, targetChanged: boolean): boolean {
    if (targetChanged) {
      return true;
    }
    if (!this.lastWorkflowFetchAt) {
      return true;
    }
    if (building === false) {
      if (!this.workflowRetryPending) {
        return false;
      }
    }
    const interval = Math.max(
      this.getRefreshIntervalMs() * WORKFLOW_REFRESH_MULTIPLIER,
      MIN_WORKFLOW_REFRESH_MS
    );
    return Date.now() - this.lastWorkflowFetchAt >= interval;
  }

  private isPollCurrent(pollGeneration: number): boolean {
    return pollGeneration === this.pollGeneration && this.pollingActive && !this.disposed;
  }

  private buildRequestErrors(failures: {
    detailsError: unknown;
    consoleError: unknown;
    pendingInputsError: unknown;
  }): string[] {
    const errors: string[] = [];
    if (failures.detailsError) {
      errors.push(`Build details: ${this.formatError(failures.detailsError)}`);
    }
    if (failures.consoleError) {
      errors.push(`Console output: ${this.formatError(failures.consoleError)}`);
    }
    if (failures.pendingInputsError) {
      errors.push(`Pending inputs: ${this.formatError(failures.pendingInputsError)}`);
    }
    return errors;
  }
}

function settled<T>(result: PromiseSettledResult<T>): { value?: T; error?: unknown } {
  return result.status === "fulfilled" ? { value: result.value } : { error: result.reason };
}
