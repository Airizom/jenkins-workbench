import * as vscode from "vscode";
import {
  getExtensionConfiguration,
  getJenkinsTaskRunnerOptions
} from "../extension/ExtensionConfig";
import type { FullEnvironmentRefreshHost } from "../extension/ExtensionRefreshHost";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { parseJobUrl } from "../jenkins/urls";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";
import { toJenkinsEnvironmentRef } from "./JenkinsTaskEnvironment";
import { JENKINS_TASK_EXIT_CODES, JenkinsTaskRunner } from "./JenkinsTaskRunner";
import {
  type JenkinsTaskDefinition,
  normalizeEnvironmentUrl,
  normalizeOptionalString,
  normalizeTaskDefinition,
  parseTaskParameters
} from "./JenkinsTaskTypes";

const STATUS_PREFIX = "[Jenkins Workbench]";

export class JenkinsTaskTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number>();
  private isClosed = false;
  private isRunning = false;
  private isCanceled = false;
  private isAtLineStart = true;
  private pendingCarriageReturn = false;
  private runner: JenkinsTaskRunner | undefined;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly definition: JenkinsTaskDefinition,
    private readonly environmentStore: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly refreshHost: FullEnvironmentRefreshHost
  ) {}

  open(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    void this.execute();
  }

  close(): void {
    if (this.isClosed) {
      return;
    }
    this.isCanceled = true;
    this.writeStatus("Task cancellation requested; stopping the owned Jenkins work.");
    this.runner?.cancel();
    this.signalClose(JENKINS_TASK_EXIT_CODES.canceled);
  }

  private writeStatus(message: string): void {
    if (this.isClosed) {
      return;
    }
    this.ensureLineStart();
    const lines = message.split(/\r\n|\r|\n/);
    if (lines.length > 1 && lines.at(-1) === "") {
      lines.pop();
    }
    this.writeEmitter.fire(lines.map((line) => `${STATUS_PREFIX} ${line}\r\n`).join(""));
    this.isAtLineStart = true;
  }

  private writeConsole(text: string): void {
    if (this.isClosed || text.length === 0) {
      return;
    }

    let normalized = "";
    for (const character of text) {
      if (this.pendingCarriageReturn) {
        normalized += "\r\n";
        this.pendingCarriageReturn = false;
        if (character === "\n") {
          continue;
        }
      }

      if (character === "\r") {
        this.pendingCarriageReturn = true;
      } else if (character === "\n") {
        normalized += "\r\n";
      } else {
        normalized += character;
      }
    }

    if (normalized.length === 0) {
      return;
    }
    this.writeEmitter.fire(normalized);
    this.isAtLineStart = normalized.endsWith("\r\n");
  }

  private ensureLineStart(): void {
    if (this.pendingCarriageReturn) {
      this.writeEmitter.fire("\r\n");
      this.pendingCarriageReturn = false;
      this.isAtLineStart = true;
      return;
    }
    if (!this.isAtLineStart) {
      this.writeEmitter.fire("\r\n");
      this.isAtLineStart = true;
    }
  }

  private signalClose(exitCode: number): void {
    if (this.isClosed) {
      return;
    }
    if (this.pendingCarriageReturn) {
      this.writeEmitter.fire("\r\n");
      this.pendingCarriageReturn = false;
    }
    this.isClosed = true;
    this.closeEmitter.fire(exitCode);
  }

  private async execute(): Promise<void> {
    this.writeStatus("Starting Jenkins task...");
    if (this.isCanceled) {
      this.signalClose(JENKINS_TASK_EXIT_CODES.canceled);
      return;
    }

    let environment: JenkinsEnvironmentRef | undefined;
    try {
      const normalized = normalizeTaskDefinition(this.definition);
      if (!normalized.definition) {
        this.fail(normalized.error ?? "Invalid Jenkins task definition.");
        return;
      }

      const environmentResult = await this.resolveEnvironment(
        normalized.definition.environmentUrl,
        normalized.definition.environmentId
      );
      if ("error" in environmentResult) {
        this.fail(environmentResult.error);
        return;
      }

      environment = environmentResult.environment;
      if (this.isCanceled) {
        return;
      }
      const jobUrl = normalized.definition.jobUrl;
      const parsedJob = parseJobUrl(jobUrl);
      const jobLabel = parsedJob ? parsedJob.fullPath.join(" / ") : jobUrl;

      const parametersResult = parseTaskParameters(normalized.definition.parameters);
      if (parametersResult.error) {
        this.fail(parametersResult.error);
        return;
      }

      this.writeStatus(`Environment: ${normalized.definition.environmentUrl}`);
      this.writeStatus(`Job: ${jobLabel}`);
      if (parametersResult.allowEmptyParams) {
        const paramKeys = parametersResult.params
          ? Array.from(new Set(parametersResult.params.keys()))
          : [];
        this.writeStatus(
          paramKeys.length > 0
            ? `Parameters: ${paramKeys.join(", ")}`
            : "Parameters: (none specified)"
        );
      }

      if (this.isCanceled) {
        return;
      }

      this.runner = new JenkinsTaskRunner(
        this.dataService,
        getJenkinsTaskRunnerOptions(getExtensionConfiguration())
      );
      if (this.isCanceled) {
        this.runner.cancel();
        await this.runner.waitForCleanup();
        return;
      }

      const result = await this.runner.run(
        {
          environment,
          jobUrl,
          parameters: parametersResult.params,
          allowEmptyParams: parametersResult.allowEmptyParams,
          waitForCompletion: normalized.definition.waitForCompletion,
          inputStepPolicy: normalized.definition.inputStepPolicy,
          inputTimeoutSeconds: normalized.definition.inputTimeoutSeconds
        },
        {
          writeStatus: (message) => this.writeStatus(message),
          writeConsole: (text) => this.writeConsole(text),
          onCleanupError: (message, error) => this.reportCleanupError(message, error)
        }
      );

      await this.runner.waitForCleanup();
      this.signalClose(result.exitCode);
    } catch (error) {
      if (this.isCanceled) {
        return;
      }
      const message = formatActionError(error);
      this.writeStatus(`Error: ${message}`);
      void vscode.window.showErrorMessage(`Jenkins task failed: ${message}`);
      this.signalClose(JENKINS_TASK_EXIT_CODES.error);
    } finally {
      if (environment) {
        this.refreshHost.fullEnvironmentRefresh({ environmentId: environment.environmentId });
      }
    }
  }

  private async resolveEnvironment(
    environmentUrl: string,
    environmentId?: string
  ): Promise<{ environment: JenkinsEnvironmentRef } | { error: string }> {
    const environments = await this.environmentStore.listEnvironmentsWithScope();
    if (environments.length === 0) {
      return {
        error: "No Jenkins environments are configured. Add one in Jenkins Workbench first."
      };
    }

    const target = normalizeEnvironmentUrl(environmentUrl);
    if (!target) {
      return { error: "environmentUrl must be a valid http(s) URL." };
    }

    const normalizedEnvironmentId = normalizeOptionalString(environmentId);
    if (normalizedEnvironmentId) {
      const matches = environments.filter(
        (environment) => environment.id === normalizedEnvironmentId
      );
      if (matches.length === 0) {
        return {
          error: `No Jenkins environment matches environmentId ${normalizedEnvironmentId}.`
        };
      }
      const workspaceMatch = matches.find((match) => match.scope === "workspace");
      const resolved = workspaceMatch ?? (matches.length === 1 ? matches[0] : undefined);
      if (!resolved) {
        return {
          error: `Multiple Jenkins environments share environmentId ${normalizedEnvironmentId}.`
        };
      }
      const resolvedUrl = normalizeEnvironmentUrl(resolved.url);
      if (resolvedUrl && resolvedUrl !== target) {
        return {
          error: `environmentUrl does not match the environmentId ${normalizedEnvironmentId}.`
        };
      }
      return { environment: toJenkinsEnvironmentRef(resolved) };
    }

    const matches = environments
      .map((environment) => {
        const normalized = normalizeEnvironmentUrl(environment.url);
        return normalized ? { environment, normalized } : undefined;
      })
      .filter((match): match is { environment: EnvironmentWithScope; normalized: string } =>
        Boolean(match)
      )
      .filter((match) => match.normalized === target);

    if (matches.length === 0) {
      return { error: `No Jenkins environment matches ${target}.` };
    }

    const workspaceMatches = matches.filter((match) => match.environment.scope === "workspace");
    if (workspaceMatches.length === 1) {
      return { environment: toJenkinsEnvironmentRef(workspaceMatches[0].environment) };
    }
    if (workspaceMatches.length > 1) {
      return {
        error: `Multiple workspace Jenkins environments match ${target}. Remove duplicates to continue.`
      };
    }

    if (matches.length === 1) {
      return { environment: toJenkinsEnvironmentRef(matches[0].environment) };
    }

    return {
      error: `Multiple Jenkins environments match ${target}. Set environmentId to disambiguate.`
    };
  }

  private fail(message: string): void {
    this.writeStatus(`Error: ${message}`);
    void vscode.window.showErrorMessage(message);
    this.signalClose(JENKINS_TASK_EXIT_CODES.error);
  }

  private reportCleanupError(message: string, error: unknown): void {
    const detail = formatActionError(error);
    console.error(`${message}: ${detail}`, error);
    void vscode.window.showErrorMessage(`${message}: ${detail}`);
  }
}
