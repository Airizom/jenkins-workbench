import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../../jenkins/types";
import type { JenkinsTestReportOptions } from "../../jenkins/JenkinsTestReportOptions";
import {
  ConsoleStreamManager,
  type ConsoleSnapshotResult
} from "./ConsoleStreamManager";

export interface BuildDetailsDataService {
  getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsBuildDetails>;
  getWorkflowRun(
    environment: JenkinsEnvironmentRef,
    buildUrl: string
  ): Promise<JenkinsWorkflowRun | undefined>;
  getTestReport(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: JenkinsTestReportOptions
  ): Promise<JenkinsTestReport | undefined>;
  getConsoleText(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars?: number
  ): Promise<JenkinsConsoleText>;
  getConsoleTextTail(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxChars: number
  ): Promise<JenkinsConsoleTextTail>;
  getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number
  ): Promise<JenkinsProgressiveConsoleText>;
  getConsoleHtmlProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    annotator?: string
  ): Promise<JenkinsProgressiveConsoleHtml>;
}

export interface BuildDetailsPollingCallbacks {
  onDetails(details: JenkinsBuildDetails): void;
  onWorkflowRun(workflowRun: JenkinsWorkflowRun | undefined): void;
  onWorkflowError(error: unknown): void;
  onTitle(title: string): void;
  onConsoleAppend(text: string): void;
  onConsoleSet(payload: { text: string; truncated: boolean }): void;
  onConsoleHtmlAppend(html: string): void;
  onConsoleHtmlSet(payload: { html: string; truncated: boolean }): void;
  onErrors(errors: string[]): void;
  onComplete(details: JenkinsBuildDetails): void;
}

export interface BuildDetailsPollingOptions {
  dataService: BuildDetailsDataService;
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
  consoleTextResult?: JenkinsConsoleTextTail;
  consoleHtmlResult?: { html: string; truncated: boolean };
  workflowRun?: JenkinsWorkflowRun;
  workflowError?: unknown;
  errors: string[];
}

const WORKFLOW_REFRESH_MULTIPLIER = 3;
const MIN_WORKFLOW_REFRESH_MS = 5000;

export class BuildDetailsPollingController {
  private readonly dataService: BuildDetailsDataService;
  private readonly environment: JenkinsEnvironmentRef;
  private readonly buildUrl: string;
  private readonly maxConsoleChars: number;
  private readonly getRefreshIntervalMs: () => number;
  private testReportOptions?: JenkinsTestReportOptions;
  private readonly callbacks: BuildDetailsPollingCallbacks;
  private readonly formatError: (error: unknown) => string;
  private readonly consoleStreamManager: ConsoleStreamManager;
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollingActive = false;
  private disposed = false;
  private pollGeneration = 0;
  private lastWorkflowFetchAt = 0;
  private lastKnownBuilding: boolean | undefined;
  private workflowRetryPending = false;

  constructor(options: BuildDetailsPollingOptions) {
    this.dataService = options.dataService;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.maxConsoleChars = options.maxConsoleChars;
    this.getRefreshIntervalMs = options.getRefreshIntervalMs;
    this.testReportOptions = options.testReportOptions;
    this.callbacks = options.callbacks;
    this.formatError = options.formatError;
    this.consoleStreamManager = new ConsoleStreamManager({
      dataService: options.dataService,
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

  async refreshConsoleSnapshot(): Promise<{
    consoleTextResult?: JenkinsConsoleTextTail;
    consoleHtmlResult?: { html: string; truncated: boolean };
  }> {
    return this.consoleStreamManager.refreshSnapshot();
  }

  async fetchTestReport(): Promise<JenkinsTestReport | undefined> {
    return this.dataService.getTestReport(
      this.environment,
      this.buildUrl,
      this.testReportOptions
    );
  }

  setTestReportOptions(options?: JenkinsTestReportOptions): void {
    this.testReportOptions = options;
  }

  async loadInitial(): Promise<BuildDetailsInitialState> {
    const detailsPromise = this.dataService.getBuildDetails(this.environment, this.buildUrl);
    const workflowPromise = this.dataService.getWorkflowRun(this.environment, this.buildUrl);
    const consolePromise = this.consoleStreamManager.loadInitialConsole();

    const errors: string[] = [];
    let details: JenkinsBuildDetails | undefined;
    let detailsError: unknown;
    let consoleTextResult: JenkinsConsoleTextTail | undefined;
    let consoleError: unknown;
    let consoleHtmlResult: { html: string; truncated: boolean } | undefined;
    let workflowRun: JenkinsWorkflowRun | undefined;
    let workflowError: unknown;

    try {
      details = await detailsPromise;
    } catch (error) {
      detailsError = error;
    }

    try {
      workflowRun = await workflowPromise;
    } catch (error) {
      workflowError = error;
    }

    let consoleSnapshot: ConsoleSnapshotResult | undefined;
    try {
      consoleSnapshot = await consolePromise;
    } catch (error) {
      consoleError = error;
    }

    if (consoleSnapshot) {
      consoleTextResult = consoleSnapshot.consoleTextResult;
      consoleHtmlResult = consoleSnapshot.consoleHtmlResult;
      if (consoleSnapshot.consoleError) {
        consoleError = consoleSnapshot.consoleError;
      }
    }

    if (detailsError) {
      errors.push(`Build details: ${this.formatError(detailsError)}`);
    }
    if (consoleError && !consoleHtmlResult) {
      errors.push(`Console output: ${this.formatError(consoleError)}`);
    }

    if (workflowError && details?.building === false) {
      this.workflowRetryPending = true;
    }

    if (workflowRun || workflowError) {
      this.lastWorkflowFetchAt = Date.now();
    }
    this.lastKnownBuilding = details?.building;

    return { details, consoleTextResult, consoleHtmlResult, workflowRun, workflowError, errors };
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
    this.pollInFlight = false;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
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
    if (this.pollInFlight || !this.pollingActive || this.disposed) {
      return;
    }

    this.pollInFlight = true;
    const pollGeneration = this.pollGeneration;

    try {
      const detailsPromise = this.dataService.getBuildDetails(this.environment, this.buildUrl);
      const consolePromise = this.consoleStreamManager.fetchNext();

      let details: JenkinsBuildDetails | undefined;
      let detailsError: unknown;
      let consoleResult: { mode: "html" | "text"; value?: unknown; error?: unknown } | undefined;
      let consoleError: unknown;
      let workflowRun: JenkinsWorkflowRun | undefined;
      let workflowError: unknown;

      try {
        details = await detailsPromise;
      } catch (error) {
        detailsError = error;
      }

      try {
        consoleResult = await consolePromise;
      } catch (error) {
        consoleError = error;
      }

      if (pollGeneration !== this.pollGeneration) {
        return;
      }

      const errors: string[] = [];

      if (detailsError) {
        errors.push(`Build details: ${this.formatError(detailsError)}`);
      }

      const consoleFailure = consoleError ?? consoleResult?.error;
      if (consoleFailure) {
        errors.push(`Console output: ${this.formatError(consoleFailure)}`);
      } else if (consoleResult?.value) {
        this.consoleStreamManager.applyResult(
          consoleResult.mode,
          consoleResult.value as
            | JenkinsProgressiveConsoleHtml
            | JenkinsProgressiveConsoleText
            | JenkinsConsoleText
        );
      }

      if (details) {
        this.callbacks.onDetails(details);
        const title = details.fullDisplayName ?? details.displayName;
        if (title) {
          this.callbacks.onTitle(title);
        }
      }

      const building = details?.building;
      const completedNow = Boolean(this.lastKnownBuilding) && building === false;
      if (details) {
        this.lastKnownBuilding = building;
      }

      const shouldFetchWorkflow = this.shouldFetchWorkflow(building, completedNow);
      if (shouldFetchWorkflow) {
        const workflowStart = Date.now();
        const retryingWorkflow = building === false && this.workflowRetryPending;
        if (retryingWorkflow) {
          this.workflowRetryPending = false;
        }
        try {
          workflowRun = await this.dataService.getWorkflowRun(this.environment, this.buildUrl);
          this.callbacks.onWorkflowRun(workflowRun);
          this.workflowRetryPending = false;
        } catch (error) {
          workflowError = error;
          this.callbacks.onWorkflowError(workflowError);
          if (building === false) {
            this.workflowRetryPending = true;
          }
        } finally {
          this.lastWorkflowFetchAt = workflowStart;
        }
      }

      this.callbacks.onErrors(errors);

      const shouldContinuePolling =
        !details ||
        details.building ||
        this.workflowRetryPending ||
        this.consoleStreamManager.shouldContinuePolling();
      if (shouldContinuePolling) {
        this.scheduleNextPoll();
      } else {
        this.stop();
      }
      if (completedNow && details) {
        this.callbacks.onComplete(details);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private shouldFetchWorkflow(building: boolean | undefined, completedNow: boolean): boolean {
    if (completedNow) {
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
}
