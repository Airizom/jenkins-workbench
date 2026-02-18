import * as crypto from "node:crypto";
import * as vscode from "vscode";
import { formatError } from "../formatters/ErrorFormatters";
import type { JenkinsClientProvider } from "../jenkins/JenkinsClientProvider";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileEnvironmentResolver } from "./JenkinsfileEnvironmentResolver";
import { parseDeclarativeValidationOutput } from "./JenkinsfileValidationParser";
import type {
  ValidationOutcome,
  ValidationRequestOptions
} from "./JenkinsfileValidationCoordinatorTypes";
import { JenkinsfileValidationOutputLogger } from "./JenkinsfileValidationOutputLogger";
import { JenkinsfileValidationStateStore } from "./JenkinsfileValidationStateStore";

export interface JenkinsfileValidationRunnerCallbacks {
  onValidationStart(): void;
  onEnvironmentResolved(environment: JenkinsEnvironmentRef): void;
  onRestoreStatus(): void;
}

export class JenkinsfileValidationRunner {
  constructor(
    private readonly clientProvider: JenkinsClientProvider,
    private readonly environmentResolver: JenkinsfileEnvironmentResolver,
    private readonly stateStore: JenkinsfileValidationStateStore,
    private readonly logger: JenkinsfileValidationOutputLogger
  ) {}

  async run(
    document: vscode.TextDocument,
    options: ValidationRequestOptions,
    callbacks: JenkinsfileValidationRunnerCallbacks
  ): Promise<ValidationOutcome> {
    const text = document.getText();
    const hash = hashText(text);
    const cached = this.stateStore.getCachedValidation(document);
    const { key, token } = this.stateStore.nextToken(document);

    callbacks.onValidationStart();
    const cancellationSubscription = options.cancellationToken?.onCancellationRequested(() => {
      if (this.stateStore.isActiveToken(key, token)) {
        callbacks.onRestoreStatus();
      }
    });

    try {
      const canceledBeforeLookup = this.getCancellationOutcome(options, callbacks);
      if (canceledBeforeLookup) {
        return canceledBeforeLookup;
      }

      const environment = await this.environmentResolver.resolveForDocument(document);
      const activeAfterLookup = this.getActiveOutcome(document, options, key, token, callbacks);
      if (activeAfterLookup) {
        return activeAfterLookup;
      }

      if (!environment) {
        this.stateStore.clearCachedValidation(document);
        this.logger.logNoEnvironment(document, options.reason);
        return { status: "completed", kind: "no-environment" };
      }

      const environmentKey = buildEnvironmentKey(environment);
      if (this.stateStore.canReuseCachedResult(options, cached, hash, environmentKey)) {
        return { status: "skipped", reason: "cached" };
      }

      callbacks.onEnvironmentResolved(environment);
      const canceledAfterStatus = this.getCancellationOutcome(options, callbacks);
      if (canceledAfterStatus) {
        return canceledAfterStatus;
      }

      let output = "";
      let requestFailed = false;
      try {
        const client = await this.clientProvider.getClient(environment);
        output = await client.validateDeclarativeJenkinsfile(text);
      } catch (error) {
        requestFailed = true;
        output = `Validation request failed: ${formatError(error)}`;
      }

      const activeAfterRequest = this.getActiveOutcome(document, options, key, token, callbacks);
      if (activeAfterRequest) {
        return activeAfterRequest;
      }

      this.logger.logValidation(document, environment, output, options.reason);

      const activeBeforeApply = this.getActiveOutcome(document, options, key, token, callbacks);
      if (activeBeforeApply) {
        return activeBeforeApply;
      }

      const findings = parseDeclarativeValidationOutput(output);
      if (document.isClosed) {
        return { status: "skipped", reason: "closed" };
      }

      return {
        status: "completed",
        kind: "result",
        errorCount: findings.length,
        findings,
        environment,
        hash,
        environmentKey,
        requestFailed
      };
    } finally {
      cancellationSubscription?.dispose();
    }
  }

  private getCancellationOutcome(
    options: ValidationRequestOptions,
    callbacks: JenkinsfileValidationRunnerCallbacks
  ): ValidationOutcome | undefined {
    if (!options.cancellationToken?.isCancellationRequested) {
      return undefined;
    }
    callbacks.onRestoreStatus();
    return { status: "canceled" };
  }

  private getActiveOutcome(
    document: vscode.TextDocument,
    options: ValidationRequestOptions,
    key: string,
    token: number,
    callbacks: JenkinsfileValidationRunnerCallbacks
  ): ValidationOutcome | undefined {
    if (document.isClosed) {
      return { status: "skipped", reason: "closed" };
    }
    if (!this.stateStore.isActiveToken(key, token)) {
      return { status: "skipped", reason: "inactive" };
    }
    return this.getCancellationOutcome(options, callbacks);
  }
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildEnvironmentKey(environment: JenkinsEnvironmentRef): string {
  return [
    environment.environmentId,
    environment.scope,
    environment.url,
    environment.username ?? ""
  ].join("|");
}
