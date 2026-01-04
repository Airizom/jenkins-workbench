import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsJobKind,
  JenkinsProgressiveConsoleText
} from "../JenkinsClient";

export type BuildActionErrorCode = "forbidden" | "not_found" | "auth" | "redirect" | "unknown";

export type JobParameterKind = "boolean" | "choice" | "password" | "string";

export interface JobParameter {
  name: string;
  kind: JobParameterKind;
  defaultValue?: string | number | boolean;
  choices?: string[];
  description?: string;
}

export type ConsoleTextResult = JenkinsConsoleText;
export type ConsoleTextTailResult = JenkinsConsoleTextTail;
export type ProgressiveConsoleTextResult = JenkinsProgressiveConsoleText;

export interface JenkinsJobInfo {
  name: string;
  url: string;
  color?: string;
  kind: JenkinsJobKind;
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
