import * as vscode from "vscode";
import { formatActionError } from "../formatters/ErrorFormatters";
import type { JenkinsDataService } from "../jenkins/JenkinsDataService";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import { parseJobUrl } from "../jenkins/urls";
import type {
  EnvironmentWithScope,
  JenkinsEnvironmentStore
} from "../storage/JenkinsEnvironmentStore";
import type { JenkinsTaskRefreshHost } from "./JenkinsTaskRefreshHost";
import {
  normalizeEnvironmentUrl,
  normalizeTaskDefinition,
  parseTaskParameters,
  type JenkinsTaskDefinition
} from "./JenkinsTaskTypes";

export class JenkinsTaskTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<void>();
  private isClosed = false;
  private isRunning = false;
  private isCanceled = false;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly definition: JenkinsTaskDefinition,
    private readonly environmentStore: JenkinsEnvironmentStore,
    private readonly dataService: JenkinsDataService,
    private readonly refreshHost: JenkinsTaskRefreshHost
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
    this.writeLine("Task canceled. Jenkins builds are not stopped by task cancellation.");
    this.signalClose();
  }

  private writeLine(message: string): void {
    if (this.isClosed) {
      return;
    }
    this.writeEmitter.fire(`${message}\r\n`);
  }

  private signalClose(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.closeEmitter.fire();
  }

  private async execute(): Promise<void> {
    this.writeLine("Starting Jenkins task...");
    if (this.isCanceled) {
      this.signalClose();
      return;
    }
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

    const environment = environmentResult.environment;
    try {
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

      this.writeLine(`Environment: ${normalized.definition.environmentUrl}`);
      this.writeLine(`Job: ${jobLabel}`);
      if (parametersResult.allowEmptyParams) {
        const paramKeys = parametersResult.params
          ? Array.from(new Set(parametersResult.params.keys()))
          : [];
        this.writeLine(
          paramKeys.length > 0
            ? `Parameters: ${paramKeys.join(", ")}`
            : "Parameters: (none specified)"
        );
      }
      this.writeLine("Canceling this task will not stop the Jenkins build.");

      if (this.isCanceled) {
        return;
      }
      try {
        const result = parametersResult.allowEmptyParams
          ? await this.dataService.triggerBuildWithParameters(
              environment,
              jobUrl,
              parametersResult.params,
              { allowEmptyParams: parametersResult.allowEmptyParams }
            )
          : await this.dataService.triggerBuild(environment, jobUrl);

        if (result.queueLocation) {
          this.writeLine(`Queued at: ${result.queueLocation}`);
        }
        this.writeLine("Build triggered successfully.");
      } catch (error) {
        const message = formatActionError(error);
        this.writeLine(`Error: ${message}`);
        void vscode.window.showErrorMessage(`Failed to trigger Jenkins build: ${message}`);
      }
    } finally {
      this.refreshHost.refreshEnvironment(environment.environmentId);
      this.signalClose();
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
      return { environment: this.toEnvironmentRef(resolved) };
    }

    const matches = environments
      .map((environment) => {
        const normalized = normalizeEnvironmentUrl(environment.url);
        return normalized ? { environment, normalized } : undefined;
      })
      .filter(
        (match): match is { environment: EnvironmentWithScope; normalized: string } =>
          Boolean(match)
      )
      .filter((match) => match.normalized === target);

    if (matches.length === 0) {
      return { error: `No Jenkins environment matches ${target}.` };
    }

    const workspaceMatches = matches.filter((match) => match.environment.scope === "workspace");
    if (workspaceMatches.length === 1) {
      return { environment: this.toEnvironmentRef(workspaceMatches[0].environment) };
    }
    if (workspaceMatches.length > 1) {
      return {
        error: `Multiple workspace Jenkins environments match ${target}. Remove duplicates to continue.`
      };
    }

    if (matches.length === 1) {
      return { environment: this.toEnvironmentRef(matches[0].environment) };
    }

    return {
      error: `Multiple Jenkins environments match ${target}. Set environmentId to disambiguate.`
    };
  }

  private toEnvironmentRef(environment: EnvironmentWithScope): JenkinsEnvironmentRef {
    return {
      environmentId: environment.id,
      scope: environment.scope,
      url: environment.url,
      username: environment.username
    };
  }

  private fail(message: string): void {
    this.writeLine(`Error: ${message}`);
    void vscode.window.showErrorMessage(message);
    this.signalClose();
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
