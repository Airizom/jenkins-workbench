import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { ensureTrailingSlash, parseQueueItemId } from "../jenkins/urls";
import type { JenkinsTaskInputStepPolicy } from "./JenkinsTaskTypes";

export const JENKINS_TASK_EXIT_CODES = {
  success: 0,
  unstable: 1,
  failure: 2,
  notBuilt: 3,
  aborted: 4,
  error: 5,
  canceled: 130
} as const;

export type JenkinsTaskRunOutcome =
  | "success"
  | "unstable"
  | "failure"
  | "notBuilt"
  | "aborted"
  | "error"
  | "canceled"
  | "submitted";

export type JenkinsTaskRunnerState =
  | "idle"
  | "triggering"
  | "queued"
  | "running"
  | "awaitingInput"
  | "completed"
  | "failed"
  | "canceled";

export interface JenkinsTaskRunRequest {
  environment: JenkinsEnvironmentRef;
  jobUrl: string;
  parameters?: URLSearchParams;
  allowEmptyParams: boolean;
  waitForCompletion: boolean;
  inputStepPolicy: JenkinsTaskInputStepPolicy;
  inputTimeoutSeconds?: number;
}

export interface JenkinsTaskRunnerOutput {
  writeStatus(message: string): void;
  writeConsole(text: string): void;
  onCleanupError?(message: string, error: unknown): void;
}

export interface JenkinsTaskRunResult {
  exitCode: number;
  outcome: JenkinsTaskRunOutcome;
  queueId?: number;
  buildUrl?: string;
  jenkinsResult?: string;
  error?: string;
}

export interface JenkinsTaskQueueItem {
  id: number;
  why?: string;
  blocked?: boolean;
  buildable?: boolean;
  stuck?: boolean;
  cancelled?: boolean;
  assignedLabel?: { name?: string };
  task?: { labelExpression?: string };
  executable?: { number: number; url?: string };
}

export interface JenkinsTaskBuildDetails {
  number: number;
  url: string;
  building?: boolean;
  result?: string;
  actions?: unknown[] | null;
}

export interface JenkinsTaskProgressiveConsoleResult {
  text: string;
  textSize: number;
  moreData: boolean;
  bytesRead: number;
}

export interface JenkinsTaskConsoleTextResult {
  text: string;
  truncated: boolean;
  bytesRead: number;
}

export interface JenkinsTaskPendingInputSummary {
  availability?: "supported" | "unsupported";
  awaitingInput: boolean;
  count: number;
  signature?: string;
  message?: string;
  inputs?: JenkinsTaskPendingInput[];
  fetchedAt: number;
}

export interface JenkinsTaskPendingInput {
  id?: string;
  signature: string;
  message?: string;
}

/**
 * The deliberately narrow Jenkins surface needed by one task execution.
 * JenkinsDataService implements this interface structurally.
 */
export interface JenkinsTaskRunnerBackend {
  triggerBuild(
    environment: JenkinsEnvironmentRef,
    jobUrl: string
  ): Promise<{ queueLocation?: string }>;
  triggerBuildWithParameters(
    environment: JenkinsEnvironmentRef,
    jobUrl: string,
    params?: URLSearchParams,
    options?: { allowEmptyParams?: boolean }
  ): Promise<{ queueLocation?: string }>;
  getQueueItems(environment: JenkinsEnvironmentRef): Promise<Array<{ id: number }>>;
  getQueueItem(environment: JenkinsEnvironmentRef, queueId: number): Promise<JenkinsTaskQueueItem>;
  getBuildDetails(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { includeCauses?: boolean; includeParameters?: boolean; statusOnly?: boolean }
  ): Promise<JenkinsTaskBuildDetails>;
  getConsoleTextProgressive(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    start: number,
    maxBytes?: number
  ): Promise<JenkinsTaskProgressiveConsoleResult>;
  getConsoleTextHead(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    maxBytes: number
  ): Promise<JenkinsTaskConsoleTextResult>;
  getPendingInputSummary(
    environment: JenkinsEnvironmentRef,
    buildUrl: string,
    options?: { mode?: "cached" | "refresh"; maxAgeMs?: number }
  ): Promise<JenkinsTaskPendingInputSummary>;
  stopBuild(environment: JenkinsEnvironmentRef, buildUrl: string): Promise<void>;
}

export interface JenkinsTaskRunnerOptions {
  pollIntervalMs?: number;
  maxConsecutiveErrors?: number;
  inputPollIntervalMs?: number;
  maxConsoleChunkBytes?: number;
  maxFullConsoleBytes?: number;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
}

interface RequiredRunnerOptions {
  pollIntervalMs: number;
  maxConsecutiveErrors: number;
  inputPollIntervalMs: number;
  maxConsoleChunkBytes: number;
  maxFullConsoleBytes: number;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
}

interface ConsolePollResult {
  progressive: boolean;
  offset: number;
  errors: number;
  pollImmediately: boolean;
  moreData: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;
const MIN_INPUT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_CONSOLE_CHUNK_BYTES = 256 * 1024;
const DEFAULT_MAX_FULL_CONSOLE_BYTES = 32 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_FINAL_CONSOLE_STABLE_MORE_DATA_POLLS = 3;

class TaskCanceledError extends Error {
  constructor() {
    super("Jenkins task canceled.");
  }
}

class RunnerFailure extends Error {}

class ConsoleLineWriter {
  private pendingCarriageReturn = false;

  constructor(private readonly write: (text: string) => void) {}

  append(text: string): void {
    let value = this.pendingCarriageReturn ? `\r${text}` : text;
    this.pendingCarriageReturn = false;
    if (value.endsWith("\r")) {
      value = value.slice(0, -1);
      this.pendingCarriageReturn = true;
    }
    if (value.length > 0) {
      this.write(value.replace(/\r\n?/g, "\n"));
    }
  }

  flush(): void {
    if (this.pendingCarriageReturn) {
      this.write("\n");
      this.pendingCarriageReturn = false;
    }
  }
}

export class JenkinsTaskRunner {
  private readonly options: RequiredRunnerOptions;
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
  private queueOwnership: "candidate" | "exclusive" | "shared" | "unknown" = "unknown";
  private submitted = false;
  private cleanupPromise: Promise<void> | undefined;

  constructor(
    private readonly backend: JenkinsTaskRunnerBackend,
    options?: JenkinsTaskRunnerOptions
  ) {
    this.options = {
      pollIntervalMs: Math.max(1, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
      maxConsecutiveErrors: Math.max(
        1,
        Math.floor(options?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS)
      ),
      inputPollIntervalMs: Math.max(
        MIN_INPUT_POLL_INTERVAL_MS,
        options?.inputPollIntervalMs ?? MIN_INPUT_POLL_INTERVAL_MS
      ),
      maxConsoleChunkBytes: Math.max(
        1024,
        Math.floor(options?.maxConsoleChunkBytes ?? DEFAULT_MAX_CONSOLE_CHUNK_BYTES)
      ),
      maxFullConsoleBytes: Math.max(
        1024,
        Math.floor(options?.maxFullConsoleBytes ?? DEFAULT_MAX_FULL_CONSOLE_BYTES)
      ),
      now: options?.now ?? Date.now,
      delay:
        options?.delay ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    };
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

      const result = await this.followBuild(request, output, consoleWriter);
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

  private async followBuild(
    request: JenkinsTaskRunRequest,
    output: JenkinsTaskRunnerOutput,
    consoleWriter: ConsoleLineWriter
  ): Promise<JenkinsTaskRunResult> {
    const buildUrl = this.buildUrl;
    if (!buildUrl) {
      throw new RunnerFailure("Jenkins build URL is unavailable.");
    }

    this.stateValue = "running";
    let statusErrors = 0;
    let inputErrors = 0;
    let consoleErrors = 0;
    let consoleOffset = 0;
    let progressive = true;
    let nextInputPollAt = 0;
    const inputStartedAtById = new Map<string, number>();
    const inputSignatureById = new Map<string, string>();
    let stopRequested = false;

    while (true) {
      this.throwIfCanceled();

      let details: JenkinsTaskBuildDetails | undefined;
      try {
        const verifyQueueOwnership = this.queueOwnership === "candidate";
        details = await this.backend.getBuildDetails(request.environment, buildUrl, {
          includeCauses: verifyQueueOwnership,
          statusOnly: !verifyQueueOwnership
        });
        this.throwIfCanceled();
        if (verifyQueueOwnership) {
          this.updateQueueOwnershipFromBuild(details);
        }
        statusErrors = 0;
      } catch (error) {
        if (error instanceof TaskCanceledError || this.cancelRequested) {
          throw new TaskCanceledError();
        }
        statusErrors++;
        if (statusErrors >= this.options.maxConsecutiveErrors) {
          throw new RunnerFailure(
            `Unable to read Jenkins build status after ${statusErrors} consecutive errors: ${errorMessage(error)}`
          );
        }
        output.writeStatus(
          `Build status unavailable; retrying (${statusErrors}/${this.options.maxConsecutiveErrors}).`
        );
      }

      const consoleResult = await this.pollConsole(
        request,
        buildUrl,
        consoleWriter,
        progressive,
        consoleOffset,
        consoleErrors
      );
      this.throwIfCanceled();
      progressive = consoleResult.progressive;
      consoleOffset = consoleResult.offset;
      consoleErrors = consoleResult.errors;

      const pollStartedAt = this.options.now();
      if (pollStartedAt >= nextInputPollAt && details?.building !== false) {
        try {
          const summary = await this.backend.getPendingInputSummary(request.environment, buildUrl, {
            mode: "refresh"
          });
          this.throwIfCanceled();
          const inputObservedAt = this.options.now();
          nextInputPollAt = inputObservedAt + this.options.inputPollIntervalMs;
          inputErrors = 0;
          if (summary.availability === "unsupported" && isInputEnforcementRequested(request)) {
            throw new RunnerFailure(
              "Jenkins does not expose pending input actions, so the configured input-step enforcement cannot be guaranteed."
            );
          }
          if (summary.awaitingInput) {
            const pendingInputs = resolvePendingInputs(summary);
            const pendingIds = new Set(pendingInputs.map((input) => input.id));
            for (const id of inputStartedAtById.keys()) {
              if (!pendingIds.has(id)) {
                inputStartedAtById.delete(id);
                inputSignatureById.delete(id);
              }
            }
            for (const input of pendingInputs) {
              if (!inputStartedAtById.has(input.id)) {
                inputStartedAtById.set(input.id, inputObservedAt);
              }
              if (inputSignatureById.get(input.id) !== input.signature) {
                inputSignatureById.set(input.id, input.signature);
                const message = input.message ? `: ${input.message}` : "";
                output.writeStatus(
                  `Jenkins is awaiting input${message}. Approve or reject it through Jenkins Workbench.`
                );
              }
            }
            this.stateValue = "awaitingInput";

            const timeoutMs =
              request.inputTimeoutSeconds === undefined
                ? undefined
                : request.inputTimeoutSeconds * 1000;
            const timedOut =
              timeoutMs !== undefined &&
              pendingInputs.some((input) => {
                const startedAt = inputStartedAtById.get(input.id);
                return startedAt !== undefined && inputObservedAt - startedAt >= timeoutMs;
              });
            if (!stopRequested && (request.inputStepPolicy === "abort" || timedOut)) {
              if (this.queueOwnership !== "exclusive") {
                throw new RunnerFailure(
                  "Jenkins input-step enforcement requires stopping the build, but this task could not verify that the build has a single trigger."
                );
              }
              output.writeStatus(
                timedOut
                  ? "Jenkins input step timed out; stopping the build."
                  : "Jenkins input step detected; stopping the build by task policy."
              );
              await this.backend.stopBuild(request.environment, buildUrl);
              this.throwIfCanceled();
              stopRequested = true;
            }
          } else {
            inputStartedAtById.clear();
            inputSignatureById.clear();
            if (!stopRequested) {
              this.stateValue = "running";
            }
          }
        } catch (error) {
          if (error instanceof TaskCanceledError || this.cancelRequested) {
            throw new TaskCanceledError();
          }
          if (error instanceof RunnerFailure) {
            throw error;
          }
          nextInputPollAt = this.options.now() + this.options.inputPollIntervalMs;
          inputErrors++;
          if (inputErrors >= this.options.maxConsecutiveErrors) {
            throw new RunnerFailure(
              `Unable to check Jenkins input steps after ${inputErrors} consecutive errors: ${errorMessage(error)}`
            );
          }
          output.writeStatus(
            `Input-step status unavailable; retrying (${inputErrors}/${this.options.maxConsecutiveErrors}).`
          );
        }
      }

      if (details && isBuildComplete(details)) {
        await this.drainFinalConsole(
          request,
          buildUrl,
          consoleWriter,
          progressive,
          consoleOffset,
          consoleErrors
        );
        this.throwIfCanceled();
        consoleWriter.flush();
        const mapped = mapJenkinsBuildResult(details.result);
        if (mapped.exitCode === JENKINS_TASK_EXIT_CODES.error) {
          throw new RunnerFailure(
            details.result
              ? `Jenkins completed with unknown result "${details.result}".`
              : "Jenkins completed without reporting a build result."
          );
        }
        output.writeStatus(`Jenkins build completed with result ${mapped.jenkinsResult}.`);
        return {
          ...mapped,
          queueId: this.queueId,
          buildUrl
        };
      }

      const retryErrors = Math.max(statusErrors, inputErrors, consoleErrors);
      if (!consoleResult.pollImmediately || retryErrors > 0) {
        await this.waitForNextPoll(retryErrors);
      }
    }
  }

  private async pollConsole(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    writer: ConsoleLineWriter,
    progressive: boolean,
    offset: number,
    errors: number
  ): Promise<ConsolePollResult> {
    if (progressive) {
      try {
        const result = await this.backend.getConsoleTextProgressive(
          request.environment,
          buildUrl,
          offset,
          this.options.maxConsoleChunkBytes
        );
        this.throwIfCanceled();
        if (!Number.isSafeInteger(result.textSize) || result.textSize < offset) {
          throw new Error("Jenkins returned an invalid progressive console offset.");
        }
        writer.append(result.text);
        return {
          progressive: true,
          offset: result.textSize,
          errors: 0,
          // Jenkins commonly keeps X-More-Data true for the lifetime of a
          // running build. Only bypass the normal poll delay when this bounded
          // read filled its byte budget and advanced, which indicates buffered
          // console data is still waiting.
          pollImmediately:
            result.moreData &&
            result.textSize > offset &&
            result.bytesRead >= this.options.maxConsoleChunkBytes,
          moreData: result.moreData
        };
      } catch (error) {
        if (error instanceof TaskCanceledError || this.cancelRequested) {
          throw new TaskCanceledError();
        }
        if (isProgressiveConsoleUnsupported(error)) {
          this.output?.writeStatus(
            "Progressive console is unsupported; switching to full console polling."
          );
          return this.pollFullConsole(request, buildUrl, writer, offset, 0);
        }
        const nextErrors = errors + 1;
        if (nextErrors < this.options.maxConsecutiveErrors) {
          this.output?.writeStatus(
            `Progressive console unavailable; retrying (${nextErrors}/${this.options.maxConsecutiveErrors}).`
          );
          return {
            progressive: true,
            offset,
            errors: nextErrors,
            pollImmediately: false,
            moreData: true
          };
        }
        this.output?.writeStatus(
          "Progressive console is unavailable; switching to full console polling."
        );
        return this.pollFullConsole(request, buildUrl, writer, offset, 0);
      }
    }
    return this.pollFullConsole(request, buildUrl, writer, offset, errors);
  }

  private async pollFullConsole(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    writer: ConsoleLineWriter,
    offset: number,
    errors: number
  ): Promise<ConsolePollResult> {
    try {
      const result = await this.backend.getConsoleTextHead(
        request.environment,
        buildUrl,
        this.options.maxFullConsoleBytes
      );
      this.throwIfCanceled();
      if (result.truncated) {
        throw new RunnerFailure(
          `Jenkins console output exceeds the ${formatByteLimit(this.options.maxFullConsoleBytes)} fallback safety limit.`
        );
      }
      const bytes = Buffer.from(result.text, "utf8");
      if (bytes.byteLength < offset) {
        throw new Error("Jenkins console output became shorter while polling.");
      }
      if (bytes.byteLength > offset) {
        writer.append(bytes.subarray(offset).toString("utf8"));
      }
      return {
        progressive: false,
        offset: bytes.byteLength,
        errors: 0,
        pollImmediately: false,
        moreData: false
      };
    } catch (error) {
      if (error instanceof TaskCanceledError || this.cancelRequested) {
        throw new TaskCanceledError();
      }
      if (error instanceof RunnerFailure) {
        throw error;
      }
      const nextErrors = errors + 1;
      if (nextErrors >= this.options.maxConsecutiveErrors) {
        throw new RunnerFailure(
          `Unable to stream Jenkins console output after ${nextErrors} consecutive errors: ${errorMessage(error)}`
        );
      }
      this.output?.writeStatus(
        `Console output unavailable; retrying (${nextErrors}/${this.options.maxConsecutiveErrors}).`
      );
      return {
        progressive: false,
        offset,
        errors: nextErrors,
        pollImmediately: false,
        moreData: true
      };
    }
  }

  private async drainFinalConsole(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    writer: ConsoleLineWriter,
    progressive: boolean,
    offset: number,
    errors: number
  ): Promise<void> {
    let currentProgressive = progressive;
    let currentOffset = offset;
    let currentErrors = errors;
    let stableMoreDataPolls = 0;
    while (true) {
      this.throwIfCanceled();
      const previousOffset = currentOffset;
      const result = await this.pollConsole(
        request,
        buildUrl,
        writer,
        currentProgressive,
        currentOffset,
        currentErrors
      );
      this.throwIfCanceled();
      currentProgressive = result.progressive;
      currentOffset = result.offset;
      currentErrors = result.errors;
      if (result.errors > 0) {
        await this.waitForNextPoll(result.errors);
        continue;
      }

      if (result.offset > previousOffset) {
        stableMoreDataPolls = 0;
        if (!result.pollImmediately) {
          await this.waitForNextPoll();
        }
        continue;
      }

      if (!result.moreData) {
        return;
      }

      stableMoreDataPolls++;
      if (stableMoreDataPolls >= MAX_FINAL_CONSOLE_STABLE_MORE_DATA_POLLS) {
        this.output?.writeStatus(
          "Jenkins continued to report more console data at a stable offset; ending the final console drain."
        );
        return;
      }
      await this.waitForNextPoll();
    }
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

  private updateQueueOwnershipFromBuild(details: JenkinsTaskBuildDetails): boolean {
    if (this.queueOwnership !== "candidate") {
      return this.queueOwnership === "exclusive";
    }
    // Jenkins folds each coalesced HTTP trigger's CauseAction into the queue item.
    // Once the item becomes a build, the carried causes are stable cleanup evidence.
    const causeCount = (details.actions ?? []).reduce<number>(
      (count, action) => count + buildActionCauseCount(action),
      0
    );
    this.queueOwnership = causeCount === 1 ? "exclusive" : causeCount > 1 ? "shared" : "unknown";
    return causeCount === 1;
  }

  private async verifyExclusiveRunningBuild(
    request: JenkinsTaskRunRequest,
    buildUrl: string
  ): Promise<boolean> {
    if (this.queueOwnership === "exclusive") {
      return true;
    }
    if (this.queueOwnership !== "candidate") {
      return false;
    }
    try {
      const details = await this.backend.getBuildDetails(request.environment, buildUrl, {
        includeCauses: true
      });
      return this.updateQueueOwnershipFromBuild(details);
    } catch {
      return false;
    }
  }

  private async ensureCleanup(): Promise<void> {
    if (!this.submitted || !this.request) {
      return;
    }
    if (!this.cleanupPromise) {
      this.cleanupPromise = this.cleanupJenkinsWork(this.request);
    }
    await this.cleanupPromise;
  }

  private async cleanupJenkinsWork(request: JenkinsTaskRunRequest): Promise<void> {
    try {
      if (!this.queueId) {
        this.output?.onCleanupError?.(
          "Jenkins accepted the build but did not identify its queue item; the build may still be active.",
          new Error("Missing Jenkins queue attribution.")
        );
        return;
      }

      if (!this.buildUrl) {
        try {
          const item = await this.backend.getQueueItem(request.environment, this.queueId);
          if (item.executable) {
            this.buildUrl = buildUrlFor(request.jobUrl, item.executable.number);
          }
        } catch {
          // The exact queue item may disappear while cancellation races with
          // execution. Without a build number there is no safe cleanup target.
        }
      }

      if (!this.buildUrl || !(await this.verifyExclusiveRunningBuild(request, this.buildUrl))) {
        this.output?.onCleanupError?.(
          "Jenkins queue ownership could not be verified; cleanup was skipped to avoid canceling shared work.",
          new Error("The queue item may include more than one trigger.")
        );
        return;
      }
      await this.backend.stopBuild(request.environment, this.buildUrl);
    } catch (error) {
      const message = `Failed to stop Jenkins build ${this.buildUrl}; it may still be running.`;
      this.output?.onCleanupError?.(message, error);
    }
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

class QueueCanceledError extends RunnerFailure {
  constructor() {
    super("Jenkins canceled the queued build before it started.");
  }
}

export function mapJenkinsBuildResult(result?: string): JenkinsTaskRunResult {
  const normalized = result?.trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return {
        exitCode: JENKINS_TASK_EXIT_CODES.success,
        outcome: "success",
        jenkinsResult: normalized
      };
    case "UNSTABLE":
      return {
        exitCode: JENKINS_TASK_EXIT_CODES.unstable,
        outcome: "unstable",
        jenkinsResult: normalized
      };
    case "FAILURE":
    case "FAILED":
    case "ERROR":
      return {
        exitCode: JENKINS_TASK_EXIT_CODES.failure,
        outcome: "failure",
        jenkinsResult: normalized
      };
    case "NOT_BUILT":
      return {
        exitCode: JENKINS_TASK_EXIT_CODES.notBuilt,
        outcome: "notBuilt",
        jenkinsResult: normalized
      };
    case "ABORTED":
      return {
        exitCode: JENKINS_TASK_EXIT_CODES.aborted,
        outcome: "aborted",
        jenkinsResult: normalized
      };
    default:
      return {
        exitCode: JENKINS_TASK_EXIT_CODES.error,
        outcome: "error",
        jenkinsResult: normalized
      };
  }
}

function buildUrlFor(jobUrl: string, buildNumber: number): string {
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new RunnerFailure("Jenkins queue item returned an invalid build number.");
  }
  return `${ensureTrailingSlash(jobUrl)}${buildNumber}/`;
}

function isBuildComplete(details: JenkinsTaskBuildDetails): boolean {
  return details.building === false || Boolean(details.result?.trim());
}

function buildActionCauseCount(action: unknown): number {
  if (!action || typeof action !== "object" || !("causes" in action)) {
    return 0;
  }
  const causes = (action as { causes?: unknown }).causes;
  return Array.isArray(causes) ? causes.length : 0;
}

function formatQueueStatus(item: JenkinsTaskQueueItem): string | undefined {
  const why = item.why?.trim();
  const label = item.assignedLabel?.name?.trim() || item.task?.labelExpression?.trim();
  if (why) {
    const labelSuffix = label && !why.includes(label) ? ` (${label})` : "";
    return `Queue: ${why}${labelSuffix}`;
  }

  const state = item.stuck
    ? "stuck"
    : item.blocked
      ? "blocked"
      : item.buildable
        ? "waiting for an executor"
        : "waiting";
  return label ? `Queue: ${state} (${label}).` : `Queue: ${state}.`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatByteLimit(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes) ? `${mebibytes} MiB` : `${bytes} bytes`;
}

function isProgressiveConsoleUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return false;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 405;
}

function isInputEnforcementRequested(request: JenkinsTaskRunRequest): boolean {
  return request.inputStepPolicy === "abort" || request.inputTimeoutSeconds !== undefined;
}

interface ResolvedPendingInput {
  id: string;
  signature: string;
  message?: string;
}

function resolvePendingInputs(summary: JenkinsTaskPendingInputSummary): ResolvedPendingInput[] {
  const inputs = summary.inputs
    ?.map((input) => {
      const signature = input.signature.trim();
      return {
        id: input.id?.trim() || signature,
        signature,
        message: input.message
      };
    })
    .filter((input) => input.signature.length > 0);
  if (inputs && inputs.length > 0) {
    return Array.from(new Map(inputs.map((input) => [input.id, input] as const)).values());
  }
  const signature = summary.signature ?? `${summary.count}:${summary.message ?? "(no message)"}`;
  return [
    {
      id: signature,
      signature,
      message: summary.message
    }
  ];
}
