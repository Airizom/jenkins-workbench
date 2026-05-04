import * as vscode from "vscode";
import type { JobSearchOptions } from "../JenkinsDataService";

export function getJobSearchTuningOptions(): JobSearchOptions {
  const configuration = vscode.workspace.getConfiguration("jenkinsWorkbench");
  return {
    concurrency: configuration.get<number>("jobSearchConcurrency"),
    backoffBaseMs: configuration.get<number>("jobSearchBackoffBaseMs"),
    backoffMaxMs: configuration.get<number>("jobSearchBackoffMaxMs"),
    maxRetries: configuration.get<number>("jobSearchMaxRetries")
  };
}
