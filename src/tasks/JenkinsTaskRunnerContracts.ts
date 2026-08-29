import type { JenkinsEnvironmentRef } from "../jenkins/JenkinsEnvironmentRef";
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

export type JenkinsTaskRunOutcome = keyof typeof JENKINS_TASK_EXIT_CODES | "submitted";

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

/** The deliberately narrow Jenkins surface needed by one task execution. */
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

export interface RequiredJenkinsTaskRunnerOptions {
  pollIntervalMs: number;
  maxConsecutiveErrors: number;
  inputPollIntervalMs: number;
  maxConsoleChunkBytes: number;
  maxFullConsoleBytes: number;
  now: () => number;
  delay: (milliseconds: number) => Promise<void>;
}
