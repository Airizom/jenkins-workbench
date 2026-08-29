import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { parseQueueItemId } from "../jenkins/urls";
import { JenkinsTaskBuildFollower } from "./JenkinsTaskBuildFollower";
import { cleanupJenkinsTaskWork } from "./JenkinsTaskCleanup";
import { ConsoleLineWriter } from "./JenkinsTaskConsoleFollower";
import {
  JENKINS_TASK_EXIT_CODES,
  type JenkinsTaskBuildDetails,
  type JenkinsTaskRunnerBackend,
  type JenkinsTaskRunnerOptions,
  type JenkinsTaskRunnerOutput,
  type JenkinsTaskRunnerState,
  type JenkinsTaskRunRequest,
  type JenkinsTaskRunResult,
  type RequiredJenkinsTaskRunnerOptions
} from "./JenkinsTaskRunnerContracts";
import {
  buildUrlFor,
  errorMessage,
  formatQueueStatus,
  QueueCanceledError,
  type QueueOwnership,
  RunnerFailure,
  resolveRunnerOptions,
  TaskCanceledError,
  updateQueueOwnership
} from "./JenkinsTaskRunnerSupport";

export type {
  JenkinsTaskBuildDetails,
  JenkinsTaskConsoleTextResult,
  JenkinsTaskPendingInput,
  JenkinsTaskPendingInputSummary,
  JenkinsTaskProgressiveConsoleResult,
  JenkinsTaskQueueItem,
  JenkinsTaskRunnerBackend,
  JenkinsTaskRunnerOptions,
  JenkinsTaskRunnerOutput,
  JenkinsTaskRunnerState,
  JenkinsTaskRunOutcome,
  JenkinsTaskRunRequest,
  JenkinsTaskRunResult
} from "./JenkinsTaskRunnerContracts";
export { JENKINS_TASK_EXIT_CODES } from "./JenkinsTaskRunnerContracts";
export { mapJenkinsBuildResult } from "./JenkinsTaskRunnerSupport";

const MAX_RETRY_DELAY_MS = 30_000;

export class JenkinsTaskRunner {
  private readonly options: RequiredJenkinsTaskRunnerOptions;
  private stateValue: JenkinsTaskRunnerState = "idle";
  private cancelRequested = false;
  private cancelResolver: ((result: JenkinsTaskRunResult) => void) | undefined;
  private readonly cancelResult: Promise<JenkinsTaskRunResult>;
  private executionCompletion: Promise<void> = Promise.resolve();
  private runStarted = false;
  private request: JenkinsTaskRunRequest | undefined;
  private output: JenkinsTaskRunnerOutput | undefined;
  private queueId: number | undefined;
  private buildUrl: string | undefined;
  private queueOwnership: QueueOwnership = "unknown";
  private submitted = false;
  private cleanupPromise: Promise<void> | undefined;

  constructor(
    private readonly backend: JenkinsTaskRunnerBackend,
    options?: JenkinsTaskRunnerOptions
  ) {
    this.options = resolveRunnerOptions(options);
    this.cancelResult = new Promise((resolve) => {
      this.cancelResolver = resolve;
    });
  }

  get state(): JenkinsTaskRunnerState {
    return this.stateValue;
  }

  async run(
    request: JenkinsTaskRunRequest,
    output: JenkinsTaskRunnerOutput
  ): Promise<JenkinsTaskRunResult> {
    if (this.runStarted) {
      return this.errorResult("This Jenkins task runner has already been started.");
    }
    this.runStarted = true;
    this.request = request;
    this.output = output;

    if (this.cancelRequested) {
      return this.canceledResult();
    }

    const execution = this.execute(request, output);
    this.executionCompletion = execution.then(
      () => undefined,
      () => undefined
    );
    return Promise.race([execution, this.cancelResult]);
  }

  /**
   * Cancels the local task immediately. Safe running-build cleanup
   * intentionally continues in the background.
   */
  cancel(): void {
    if (this.cancelRequested || this.stateValue === "completed" || this.stateValue === "failed") {
      return;
    }
    this.cancelRequested = true;
    this.stateValue = "canceled";
    this.cancelResolver?.(this.canceledResult());
    if (this.runStarted) {
      void this.ensureCleanup();
    }
  }

  async waitForCleanup(): Promise<void> {
    await this.executionCompletion;
    await this.cleanupPromise;
  }

  private async execute(
    request: JenkinsTaskRunRequest,
    output: JenkinsTaskRunnerOutput
  ): Promise<JenkinsTaskRunResult> {
    const consoleWriter = new ConsoleLineWriter((text) => output.writeConsole(text));
    try {
      this.stateValue = "triggering";
      output.writeStatus("Triggering Jenkins build...");
      const queuedItemIdsBeforeTrigger = await this.getQueuedItemIds(request.environment);
      this.throwIfCanceled();
      const triggerResult = request.allowEmptyParams
        ? await this.backend.triggerBuildWithParameters(
            request.environment,
            request.jobUrl,
            request.parameters,
            { allowEmptyParams: true }
          )
        : await this.backend.triggerBuild(request.environment, request.jobUrl);
      this.submitted = true;
      this.queueId = parseQueueItemId(triggerResult.queueLocation);
      if (this.queueId !== undefined && queuedItemIdsBeforeTrigger !== undefined) {
        this.queueOwnership = queuedItemIdsBeforeTrigger.has(this.queueId) ? "shared" : "candidate";
      }

      if (!request.waitForCompletion) {
        this.throwIfCanceled();
        if (triggerResult.queueLocation) {
          output.writeStatus(`Queued at ${triggerResult.queueLocation}`);
        }
        output.writeStatus("Build triggered successfully.");
        this.stateValue = "completed";
        return {
          exitCode: JENKINS_TASK_EXIT_CODES.success,
          outcome: "submitted",
          queueId: this.queueId
        };
      }

      if (!this.queueId) {
        throw new RunnerFailure(
          "Jenkins accepted the build, but did not return a usable queue location. " +
            "The build may still have been submitted; refusing to guess which build belongs to this task."
        );
      }
      output.writeStatus(`Following Jenkins queue item ${this.queueId}.`);
      this.throwIfCanceled();
      await this.followQueue(request, output);
      this.throwIfCanceled();
      if (!this.buildUrl) {
        throw new RunnerFailure("Jenkins queue item did not identify an executable build.");
      }

      const result = await this.createBuildFollower(output).follow(
        request,
        this.buildUrl,
        this.queueId,
        consoleWriter
      );
      this.stateValue = result.exitCode === JENKINS_TASK_EXIT_CODES.error ? "failed" : "completed";
      return result;
    } catch (error) {
      if (error instanceof TaskCanceledError || this.cancelRequested) {
        await this.ensureCleanup();
        return this.canceledResult();
      }
      if (error instanceof QueueCanceledError) {
        output.writeStatus(error.message);
        this.stateValue = "completed";
        return {
          exitCode: JENKINS_TASK_EXIT_CODES.aborted,
          outcome: "aborted",
          queueId: this.queueId,
          jenkinsResult: "ABORTED"
        };
      }

      const message = errorMessage(error);
      consoleWriter.flush();
      output.writeStatus(`Error: ${message}`);
      if (this.submitted) {
        await this.ensureCleanup();
      }
      this.stateValue = "failed";
      return this.errorResult(message);
    } finally {
      consoleWriter.flush();
    }
  }

  private async followQueue(
    request: JenkinsTaskRunRequest,
    output: JenkinsTaskRunnerOutput
  ): Promise<void> {
    const queueId = this.queueId;
    if (!queueId) {
      throw new RunnerFailure("Jenkins queue item could not be attributed.");
    }

    this.stateValue = "queued";
    let errors = 0;
    let lastStatus = "";
    while (!this.buildUrl) {
      this.throwIfCanceled();
      try {
        const item = await this.backend.getQueueItem(request.environment, queueId);
        this.throwIfCanceled();
        errors = 0;
        if (item.cancelled) {
          throw new QueueCanceledError();
        }
        if (item.executable) {
          this.buildUrl = buildUrlFor(request.jobUrl, item.executable.number);
          output.writeStatus(`Jenkins started build #${item.executable.number}.`);
          return;
        }
        const status = formatQueueStatus(item);
        if (status && status !== lastStatus) {
          output.writeStatus(status);
          lastStatus = status;
        }
      } catch (error) {
        if (error instanceof TaskCanceledError || this.cancelRequested) {
          throw new TaskCanceledError();
        }
        if (error instanceof QueueCanceledError) {
          this.stateValue = "completed";
          throw error;
        }
        errors++;
        if (errors >= this.options.maxConsecutiveErrors) {
          throw new RunnerFailure(
            `Unable to follow Jenkins queue item ${queueId} after ${errors} consecutive errors: ${errorMessage(error)}`
          );
        }
        output.writeStatus(
          `Queue status unavailable; retrying (${errors}/${this.options.maxConsecutiveErrors}).`
        );
      }
      await this.waitForNextPoll(errors);
    }
  }

  private createBuildFollower(output: JenkinsTaskRunnerOutput): JenkinsTaskBuildFollower {
    return new JenkinsTaskBuildFollower(this.backend, this.options, output, {
      isCanceled: () => this.cancelRequested,
      throwIfCanceled: () => this.throwIfCanceled(),
      waitForNextPoll: (errors) => this.waitForNextPoll(errors),
      getQueueOwnership: () => this.queueOwnership,
      updateQueueOwnership: (details) => this.updateQueueOwnershipFromBuild(details),
      setState: (state) => {
        this.stateValue = state;
      }
    });
  }

  private async waitForNextPoll(consecutiveErrors = 0): Promise<void> {
    const multiplier = consecutiveErrors > 0 ? 2 ** Math.min(consecutiveErrors - 1, 10) : 1;
    const delayMs = Math.min(this.options.pollIntervalMs * multiplier, MAX_RETRY_DELAY_MS);
    await Promise.race([
      this.options.delay(delayMs),
      this.cancelResult.then(() => {
        throw new TaskCanceledError();
      })
    ]);
    this.throwIfCanceled();
  }

  private throwIfCanceled(): void {
    if (this.cancelRequested) {
      throw new TaskCanceledError();
    }
  }

  private async getQueuedItemIds(
    environment: JenkinsEnvironmentRef
  ): Promise<Set<number> | undefined> {
    try {
      const items = await this.backend.getQueueItems(environment);
      return new Set(
        items.map((item) => item.id).filter((id) => Number.isSafeInteger(id) && id > 0)
      );
    } catch {
      return undefined;
    }
  }

  private updateQueueOwnershipFromBuild(details: JenkinsTaskBuildDetails): QueueOwnership {
    this.queueOwnership = updateQueueOwnership(this.queueOwnership, details);
    return this.queueOwnership;
  }

  private async ensureCleanup(): Promise<void> {
    if (!this.submitted || !this.request || !this.output) {
      return;
    }
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.queueId
        ? cleanupJenkinsTaskWork(this.backend, this.request, this.output, {
            queueId: this.queueId,
            getBuildUrl: () => this.buildUrl,
            setBuildUrl: (buildUrl) => {
              this.buildUrl = buildUrl;
            },
            getQueueOwnership: () => this.queueOwnership,
            updateQueueOwnership: (details) => this.updateQueueOwnershipFromBuild(details)
          })
        : this.reportMissingQueueAttribution(this.output);
    }
    await this.cleanupPromise;
  }

  private async reportMissingQueueAttribution(output: JenkinsTaskRunnerOutput): Promise<void> {
    output.onCleanupError?.(
      "Jenkins accepted the build but did not identify its queue item; the build may still be active.",
      new Error("Missing Jenkins queue attribution.")
    );
  }

  private canceledResult(): JenkinsTaskRunResult {
    return {
      exitCode: JENKINS_TASK_EXIT_CODES.canceled,
      outcome: "canceled",
      queueId: this.queueId,
      buildUrl: this.buildUrl
    };
  }

  private errorResult(message: string): JenkinsTaskRunResult {
    return {
      exitCode: JENKINS_TASK_EXIT_CODES.error,
      outcome: "error",
      queueId: this.queueId,
      buildUrl: this.buildUrl,
      error: message
    };
  }
}
