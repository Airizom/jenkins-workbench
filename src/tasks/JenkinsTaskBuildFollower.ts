import {
  type ConsoleLineWriter,
  JenkinsTaskConsoleFollower,
  type JenkinsTaskPollingControl
} from "./JenkinsTaskConsoleFollower";
import {
  JENKINS_TASK_EXIT_CODES,
  type JenkinsTaskBuildDetails,
  type JenkinsTaskRunnerBackend,
  type JenkinsTaskRunnerOutput,
  type JenkinsTaskRunnerState,
  type JenkinsTaskRunRequest,
  type JenkinsTaskRunResult,
  type RequiredJenkinsTaskRunnerOptions
} from "./JenkinsTaskRunnerContracts";
import {
  errorMessage,
  isBuildComplete,
  isInputEnforcementRequested,
  mapJenkinsBuildResult,
  type QueueOwnership,
  RunnerFailure,
  resolvePendingInputs,
  TaskCanceledError
} from "./JenkinsTaskRunnerSupport";

interface JenkinsTaskBuildControl extends JenkinsTaskPollingControl {
  getQueueOwnership(): QueueOwnership;
  updateQueueOwnership(details: JenkinsTaskBuildDetails): QueueOwnership;
  setState(state: JenkinsTaskRunnerState): void;
}

export class JenkinsTaskBuildFollower {
  private readonly consoleFollower: JenkinsTaskConsoleFollower;

  constructor(
    private readonly backend: JenkinsTaskRunnerBackend,
    private readonly options: RequiredJenkinsTaskRunnerOptions,
    private readonly output: JenkinsTaskRunnerOutput,
    private readonly control: JenkinsTaskBuildControl
  ) {
    this.consoleFollower = new JenkinsTaskConsoleFollower(backend, options, output, control);
  }

  async follow(
    request: JenkinsTaskRunRequest,
    buildUrl: string,
    queueId: number,
    consoleWriter: ConsoleLineWriter
  ): Promise<JenkinsTaskRunResult> {
    this.control.setState("running");
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
      this.control.throwIfCanceled();
      let details: JenkinsTaskBuildDetails | undefined;
      try {
        const verifyQueueOwnership = this.control.getQueueOwnership() === "candidate";
        details = await this.backend.getBuildDetails(request.environment, buildUrl, {
          includeCauses: verifyQueueOwnership,
          statusOnly: !verifyQueueOwnership
        });
        this.control.throwIfCanceled();
        if (verifyQueueOwnership) {
          this.control.updateQueueOwnership(details);
        }
        statusErrors = 0;
      } catch (error) {
        if (error instanceof TaskCanceledError || this.control.isCanceled()) {
          throw new TaskCanceledError();
        }
        statusErrors++;
        if (statusErrors >= this.options.maxConsecutiveErrors) {
          throw new RunnerFailure(
            `Unable to read Jenkins build status after ${statusErrors} consecutive errors: ${errorMessage(error)}`
          );
        }
        this.output.writeStatus(
          `Build status unavailable; retrying (${statusErrors}/${this.options.maxConsecutiveErrors}).`
        );
      }

      const consoleResult = await this.consoleFollower.poll(
        request,
        buildUrl,
        consoleWriter,
        progressive,
        consoleOffset,
        consoleErrors
      );
      this.control.throwIfCanceled();
      progressive = consoleResult.progressive;
      consoleOffset = consoleResult.offset;
      consoleErrors = consoleResult.errors;

      const pollStartedAt = this.options.now();
      if (pollStartedAt >= nextInputPollAt && details?.building !== false) {
        try {
          const summary = await this.backend.getPendingInputSummary(request.environment, buildUrl, {
            mode: "refresh"
          });
          this.control.throwIfCanceled();
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
                this.output.writeStatus(
                  `Jenkins is awaiting input${message}. Approve or reject it through Jenkins Workbench.`
                );
              }
            }
            this.control.setState("awaitingInput");

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
              if (this.control.getQueueOwnership() !== "exclusive") {
                throw new RunnerFailure(
                  "Jenkins input-step enforcement requires stopping the build, but this task could not verify that the build has a single trigger."
                );
              }
              this.output.writeStatus(
                timedOut
                  ? "Jenkins input step timed out; stopping the build."
                  : "Jenkins input step detected; stopping the build by task policy."
              );
              await this.backend.stopBuild(request.environment, buildUrl);
              this.control.throwIfCanceled();
              stopRequested = true;
            }
          } else {
            inputStartedAtById.clear();
            inputSignatureById.clear();
            if (!stopRequested) {
              this.control.setState("running");
            }
          }
        } catch (error) {
          if (error instanceof TaskCanceledError || this.control.isCanceled()) {
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
          this.output.writeStatus(
            `Input-step status unavailable; retrying (${inputErrors}/${this.options.maxConsecutiveErrors}).`
          );
        }
      }

      if (details && isBuildComplete(details)) {
        await this.consoleFollower.drain(
          request,
          buildUrl,
          consoleWriter,
          progressive,
          consoleOffset,
          consoleErrors
        );
        this.control.throwIfCanceled();
        consoleWriter.flush();
        const mapped = mapJenkinsBuildResult(details.result);
        if (mapped.exitCode === JENKINS_TASK_EXIT_CODES.error) {
          throw new RunnerFailure(
            details.result
              ? `Jenkins completed with unknown result "${details.result}".`
              : "Jenkins completed without reporting a build result."
          );
        }
        this.output.writeStatus(`Jenkins build completed with result ${mapped.jenkinsResult}.`);
        return { ...mapped, queueId, buildUrl };
      }

      const retryErrors = Math.max(statusErrors, inputErrors, consoleErrors);
      if (!consoleResult.pollImmediately || retryErrors > 0) {
        await this.control.waitForNextPoll(retryErrors);
      }
    }
  }
}
