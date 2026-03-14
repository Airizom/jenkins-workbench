import type * as vscode from "vscode";
import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";

export type JenkinsfileValidationStatusState =
  | {
      kind: "result";
      errorCount: number;
      environment?: JenkinsEnvironmentRef;
      stale?: boolean;
    }
  | {
      kind: "request-failed";
      environment?: JenkinsEnvironmentRef;
      message: string;
    }
  | {
      kind: "no-environment";
    };

export interface JenkinsfileValidationStatusProvider {
  getValidationState(document: vscode.TextDocument): JenkinsfileValidationStatusState | undefined;
  onDidChangeValidationStatus: vscode.Event<vscode.Uri>;
}
