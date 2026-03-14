import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
import type { JenkinsfileValidationFinding } from "./JenkinsfileValidationTypes";

export type ValidationReason = "save" | "command" | "change" | "open";

export interface ValidationRequestOptions {
  reason: ValidationReason;
  force?: boolean;
  cancellationToken?: vscode.CancellationToken;
}

export interface ValidationCacheEntry {
  hash: string;
  environmentKey: string;
}

export type ValidationOutcome =
  | { status: "skipped"; reason?: "cached" | "closed" | "inactive" }
  | { status: "canceled" }
  | {
      status: "completed";
      kind: "result";
      errorCount: number;
      findings: JenkinsfileValidationFinding[];
      environment: JenkinsEnvironmentRef;
      hash: string;
      environmentKey: string;
    }
  | {
      status: "completed";
      kind: "request-failed";
      environment: JenkinsEnvironmentRef;
      message: string;
    }
  | { status: "completed"; kind: "no-environment" };
