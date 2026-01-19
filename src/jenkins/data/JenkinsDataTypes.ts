import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsJobKind,
  JenkinsNode,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText
} from "../JenkinsClient";

export type JenkinsActionErrorCode = "forbidden" | "not_found" | "auth" | "redirect" | "unknown";
export type BuildActionErrorCode = JenkinsActionErrorCode;

export type JobParameterKind = "boolean" | "choice" | "password" | "string";

export interface JobParameter {
  name: string;
  kind: JobParameterKind;
  defaultValue?: string | number | boolean;
  choices?: string[];
  description?: string;
}

export interface PendingInputAction {
  id: string;
  message: string;
  submitter?: string;
  proceedText?: string;
  proceedUrl?: string;
  abortUrl?: string;
  parameters: JobParameter[];
}

export interface PendingInputSummary {
  awaitingInput: boolean;
  count: number;
  signature?: string;
  message?: string;
  fetchedAt: number;
}

export type ConsoleTextResult = JenkinsConsoleText;
export type ConsoleTextTailResult = JenkinsConsoleTextTail;
export type ProgressiveConsoleTextResult = JenkinsProgressiveConsoleText;
export type ProgressiveConsoleHtmlResult = JenkinsProgressiveConsoleHtml;

export interface JenkinsJobInfo {
  name: string;
  url: string;
  color?: string;
  kind: JenkinsJobKind;
}

export interface JenkinsNodeInfo extends JenkinsNode {
  nodeUrl?: string;
}

export interface JenkinsQueueItemInfo {
  id: number;
  name: string;
  position: number;
  reason?: string;
  inQueueSince?: number;
  taskUrl?: string;
}

export interface JobPathSegment {
  name: string;
  url: string;
  kind: JenkinsJobKind;
}

export interface JobSearchEntry {
  name: string;
  url: string;
  color?: string;
  kind: JenkinsJobKind;
  fullName: string;
  path: JobPathSegment[];
}

export type CancellationChecker = () => boolean;

export interface CancellationSignal {
  isCancellationRequested: boolean;
}

export type CancellationInput = CancellationChecker | CancellationSignal;

export interface JobSearchOptions {
  cancellation?: CancellationInput;
  maxResults?: number;
  batchSize?: number;
  concurrency?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  maxRetries?: number;
}
