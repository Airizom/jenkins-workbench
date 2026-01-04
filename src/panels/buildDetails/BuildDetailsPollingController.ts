import type { JenkinsEnvironmentRef } from "../../jenkins/JenkinsEnvironmentRef";
import type {
  JenkinsBuildDetails,
  JenkinsConsoleText,
  JenkinsTestReport,
  JenkinsWorkflowRun
} from "../../jenkins/types";

interface JenkinsConsoleTextTail extends JenkinsConsoleText {
  nextStart: number;
  progressiveSupported: boolean;
}

interface JenkinsProgressiveConsoleText {
  text: string;
  textSize: number;
  moreData: boolean;
}

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
    buildUrl: string
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
}

export interface BuildDetailsPollingCallbacks {
  onDetails(details: JenkinsBuildDetails): void;
  onWorkflowRun(workflowRun: JenkinsWorkflowRun | undefined): void;
  onWorkflowError(error: unknown): void;
  onTitle(title: string): void;
  onConsoleAppend(text: string): void;
  onConsoleSet(payload: { text: string; truncated: boolean }): void;
  onErrors(errors: string[]): void;
  onComplete(details: JenkinsBuildDetails): void;
}

export interface BuildDetailsPollingOptions {
  dataService: BuildDetailsDataService;
  environment: JenkinsEnvironmentRef;
  buildUrl: string;
  maxConsoleChars: number;
  getRefreshIntervalMs: () => number;
  callbacks: BuildDetailsPollingCallbacks;
  formatError: (error: unknown) => string;
}

export interface BuildDetailsInitialState {
  details?: JenkinsBuildDetails;
  consoleTextResult?: JenkinsConsoleTextTail;
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
  private readonly callbacks: BuildDetailsPollingCallbacks;
  private readonly formatError: (error: unknown) => string;
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private pollingActive = false;
  private disposed = false;
  private pollGeneration = 0;
  private consoleOffset = 0;
  private consoleBuffer = "";
  private consoleTruncated = false;
  private progressiveSupported = false;
  private lastWorkflowFetchAt = 0;
  private lastKnownBuilding: boolean | undefined;
  private workflowRetryPending = false;

  constructor(options: BuildDetailsPollingOptions) {
    this.dataService = options.dataService;
    this.environment = options.environment;
    this.buildUrl = options.buildUrl;
    this.maxConsoleChars = options.maxConsoleChars;
    this.getRefreshIntervalMs = options.getRefreshIntervalMs;
    this.callbacks = options.callbacks;
    this.formatError = options.formatError;
  }

  async loadInitial(): Promise<BuildDetailsInitialState> {
    const detailsPromise = this.dataService.getBuildDetails(this.environment, this.buildUrl);
    const workflowPromise = this.dataService.getWorkflowRun(this.environment, this.buildUrl);
    const consolePromise = this.dataService.getConsoleTextTail(
      this.environment,
      this.buildUrl,
      this.maxConsoleChars
    );

    const errors: string[] = [];
    let details: JenkinsBuildDetails | undefined;
    let detailsError: unknown;
    let consoleTextResult: JenkinsConsoleTextTail | undefined;
    let consoleError: unknown;
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

    try {
      consoleTextResult = await consolePromise;
    } catch (error) {
      consoleError = error;
    }

    if (detailsError) {
      errors.push(`Build details: ${this.formatError(detailsError)}`);
    }
    if (consoleError) {
      errors.push(`Console output: ${this.formatError(consoleError)}`);
    }

    if (consoleTextResult) {
      this.consoleBuffer = consoleTextResult.text;
      this.consoleTruncated = consoleTextResult.truncated;
      this.consoleOffset = consoleTextResult.nextStart;
      this.progressiveSupported = consoleTextResult.progressiveSupported;
    } else {
      this.consoleBuffer = "";
      this.consoleTruncated = false;
      this.consoleOffset = 0;
      this.progressiveSupported = false;
    }

    if (workflowError && details?.building === false) {
      this.workflowRetryPending = true;
    }

    if (workflowRun || workflowError) {
      this.lastWorkflowFetchAt = Date.now();
    }
    this.lastKnownBuilding = details?.building;

    return { details, consoleTextResult, workflowRun, workflowError, errors };
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
      const usingProgressive = this.progressiveSupported;
      const consolePromise: Promise<JenkinsProgressiveConsoleText | JenkinsConsoleText> =
        usingProgressive
          ? this.dataService.getConsoleTextProgressive(
              this.environment,
              this.buildUrl,
              this.consoleOffset
            )
          : this.dataService.getConsoleText(this.environment, this.buildUrl, this.maxConsoleChars);

      let details: JenkinsBuildDetails | undefined;
      let detailsError: unknown;
      let consoleValue: JenkinsProgressiveConsoleText | JenkinsConsoleText | undefined;
      let consoleError: unknown;
      let workflowRun: JenkinsWorkflowRun | undefined;
      let workflowError: unknown;

      try {
        details = await detailsPromise;
      } catch (error) {
        detailsError = error;
      }

      try {
        consoleValue = await consolePromise;
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

      if (consoleError) {
        errors.push(`Console output: ${this.formatError(consoleError)}`);
        if (usingProgressive) {
          this.progressiveSupported = false;
        }
      } else if (consoleValue) {
        if (usingProgressive) {
          this.handleProgressiveChunk(consoleValue as JenkinsProgressiveConsoleText);
        } else {
          const consoleText = consoleValue as JenkinsConsoleText;
          this.consoleBuffer = consoleText.text;
          this.consoleTruncated = consoleText.truncated;
          this.consoleOffset = this.consoleBuffer.length;
          this.callbacks.onConsoleSet({
            text: this.consoleBuffer,
            truncated: this.consoleTruncated
          });
        }
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

      if (!details || details.building || this.workflowRetryPending) {
        this.scheduleNextPoll();
        return;
      }

      this.stop();
      if (completedNow) {
        this.callbacks.onComplete(details);
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  private handleProgressiveChunk(chunk: JenkinsProgressiveConsoleText): void {
    this.consoleOffset = chunk.textSize;
    if (!chunk.text) {
      return;
    }

    const nextBuffer = this.consoleBuffer + chunk.text;
    if (nextBuffer.length > this.maxConsoleChars) {
      this.consoleBuffer = nextBuffer.slice(nextBuffer.length - this.maxConsoleChars);
      this.consoleTruncated = true;
      this.callbacks.onConsoleSet({
        text: this.consoleBuffer,
        truncated: true
      });
      return;
    }

    this.consoleBuffer = nextBuffer;
    this.callbacks.onConsoleAppend(chunk.text);
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
