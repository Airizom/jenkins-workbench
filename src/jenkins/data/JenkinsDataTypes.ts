import type {
  JenkinsConsoleText,
  JenkinsConsoleTextTail,
  JenkinsFlowNodeLog,
  JenkinsJobKind,
  JenkinsNode,
  JenkinsProgressiveConsoleHtml,
  JenkinsProgressiveConsoleText,
  JenkinsView,
  JenkinsWorkflowStage
} from "../JenkinsClient";

export type { BuildParameterPayload } from "../BuildParameterRequests";

export type JenkinsActionErrorCode = "forbidden" | "not_found" | "auth" | "redirect" | "unknown";

export type JobParameterKind =
  | "boolean"
  | "choice"
  | "password"
  | "string"
  | "credentials"
  | "run"
  | "file"
  | "text"
  | "multiChoice";

export interface JobParameter {
  name: string;
  kind: JobParameterKind;
  defaultValue?: string | number | boolean | string[];
  choices?: string[];
  description?: string;
  rawType?: string;
  isSensitive?: boolean;
  runProjectName?: string;
  multiSelectDelimiter?: string;
  allowsMultiple?: boolean;
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
  availability?: "supported" | "unsupported";
  awaitingInput: boolean;
  count: number;
  signature?: string;
  message?: string;
  inputs?: PendingInputSummaryEntry[];
  fetchedAt: number;
}

export interface PendingInputSummaryEntry {
  id: string;
  signature: string;
  message?: string;
}

export type ConsoleTextResult = JenkinsConsoleText;
export type ConsoleTextTailResult = JenkinsConsoleTextTail;
export type ProgressiveConsoleTextResult = JenkinsProgressiveConsoleText;
export type ProgressiveConsoleHtmlResult = JenkinsProgressiveConsoleHtml;
export type FlowNodeLogResult = JenkinsFlowNodeLog;
export type FlowNodeDetailsResult = JenkinsWorkflowStage;

export interface JenkinsJobInfo {
  name: string;
  url: string;
  color?: string;
  kind: JenkinsJobKind;
}

export interface JenkinsNodeInfo extends JenkinsNode {
  nodeUrl?: string;
}

export interface JenkinsViewInfo extends JenkinsView {}

export interface JenkinsRootJobCollectionScope {
  kind: "root";
}

export interface JenkinsViewJobCollectionScope {
  kind: "view";
  viewUrl: string;
}

export type JenkinsJobCollectionScope =
  | JenkinsRootJobCollectionScope
  | JenkinsViewJobCollectionScope;

export interface JenkinsJobCollectionRequest {
  scope: JenkinsJobCollectionScope;
  folderUrl?: string;
}

export interface JenkinsJobFetchOptions {
  mode?: "cached" | "refresh";
}

export interface JenkinsQueueItemInfo {
  id: number;
  name: string;
  position: number;
  reason?: string;
  inQueueSince?: number;
  taskUrl?: string;
  assignedLabelName?: string;
  blocked?: boolean;
  buildable?: boolean;
  stuck?: boolean;
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
  mode?: "cached" | "refresh";
  cancellation?: CancellationInput;
  maxResults?: number;
  batchSize?: number;
  concurrency?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  maxRetries?: number;
}
