import { ensureTrailingSlash } from "../jenkins/urls";
import {
  JENKINS_TASK_EXIT_CODES,
  type JenkinsTaskBuildDetails,
  type JenkinsTaskPendingInputSummary,
  type JenkinsTaskQueueItem,
  type JenkinsTaskRunnerOptions,
  type JenkinsTaskRunResult,
  type RequiredJenkinsTaskRunnerOptions
} from "./JenkinsTaskRunnerContracts";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;
const MIN_INPUT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_CONSOLE_CHUNK_BYTES = 256 * 1024;
const DEFAULT_MAX_FULL_CONSOLE_BYTES = 32 * 1024 * 1024;

export type QueueOwnership = "candidate" | "exclusive" | "shared" | "unknown";

export class TaskCanceledError extends Error {
  constructor() {
    super("Jenkins task canceled.");
  }
}

export class RunnerFailure extends Error {}

export class QueueCanceledError extends RunnerFailure {
  constructor() {
    super("Jenkins canceled the queued build before it started.");
  }
}

export function resolveRunnerOptions(
  options?: JenkinsTaskRunnerOptions
): RequiredJenkinsTaskRunnerOptions {
  return {
    pollIntervalMs: Math.max(1, options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
    maxConsecutiveErrors: Math.max(
      1,
      Math.floor(options?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS)
    ),
    inputPollIntervalMs: Math.max(
      MIN_INPUT_POLL_INTERVAL_MS,
      options?.inputPollIntervalMs ?? MIN_INPUT_POLL_INTERVAL_MS
    ),
    maxConsoleChunkBytes: Math.max(
      1024,
      Math.floor(options?.maxConsoleChunkBytes ?? DEFAULT_MAX_CONSOLE_CHUNK_BYTES)
    ),
    maxFullConsoleBytes: Math.max(
      1024,
      Math.floor(options?.maxFullConsoleBytes ?? DEFAULT_MAX_FULL_CONSOLE_BYTES)
    ),
    now: options?.now ?? Date.now,
    delay:
      options?.delay ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  };
}

export function mapJenkinsBuildResult(result?: string): JenkinsTaskRunResult {
  const normalized = result?.trim().toUpperCase();
  switch (normalized) {
    case "SUCCESS":
      return resultFor(JENKINS_TASK_EXIT_CODES.success, "success", normalized);
    case "UNSTABLE":
      return resultFor(JENKINS_TASK_EXIT_CODES.unstable, "unstable", normalized);
    case "FAILURE":
    case "FAILED":
    case "ERROR":
      return resultFor(JENKINS_TASK_EXIT_CODES.failure, "failure", normalized);
    case "NOT_BUILT":
      return resultFor(JENKINS_TASK_EXIT_CODES.notBuilt, "notBuilt", normalized);
    case "ABORTED":
      return resultFor(JENKINS_TASK_EXIT_CODES.aborted, "aborted", normalized);
    default:
      return resultFor(JENKINS_TASK_EXIT_CODES.error, "error", normalized);
  }
}

function resultFor(
  exitCode: number,
  outcome: JenkinsTaskRunResult["outcome"],
  jenkinsResult?: string
): JenkinsTaskRunResult {
  return { exitCode, outcome, jenkinsResult };
}

export function buildUrlFor(jobUrl: string, buildNumber: number): string {
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new RunnerFailure("Jenkins queue item returned an invalid build number.");
  }
  return `${ensureTrailingSlash(jobUrl)}${buildNumber}/`;
}

export function isBuildComplete(details: JenkinsTaskBuildDetails): boolean {
  return (
    details.building === false ||
    (details.building === undefined && Boolean(details.result?.trim()))
  );
}

export function updateQueueOwnership(
  ownership: QueueOwnership,
  details: JenkinsTaskBuildDetails
): QueueOwnership {
  if (ownership !== "candidate") {
    return ownership;
  }
  // Jenkins folds each coalesced HTTP trigger's CauseAction into the queue item.
  // Once the item becomes a build, the carried causes are stable cleanup evidence.
  const causeCount = (details.actions ?? []).reduce<number>(
    (count, action) => count + buildActionCauseCount(action),
    0
  );
  return causeCount === 1 ? "exclusive" : causeCount > 1 ? "shared" : "unknown";
}

function buildActionCauseCount(action: unknown): number {
  if (!action || typeof action !== "object" || !("causes" in action)) {
    return 0;
  }
  const causes = (action as { causes?: unknown }).causes;
  return Array.isArray(causes) ? causes.length : 0;
}

export function formatQueueStatus(item: JenkinsTaskQueueItem): string | undefined {
  const why = item.why?.trim();
  const label = item.assignedLabel?.name?.trim() || item.task?.labelExpression?.trim();
  if (why) {
    const labelSuffix = label && !why.includes(label) ? ` (${label})` : "";
    return `Queue: ${why}${labelSuffix}`;
  }
  const state = item.stuck
    ? "stuck"
    : item.blocked
      ? "blocked"
      : item.buildable
        ? "waiting for an executor"
        : "waiting";
  return label ? `Queue: ${state} (${label}).` : `Queue: ${state}.`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatByteLimit(bytes: number): string {
  const mebibytes = bytes / (1024 * 1024);
  return Number.isInteger(mebibytes) ? `${mebibytes} MiB` : `${bytes} bytes`;
}

export function isProgressiveConsoleUnsupported(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("statusCode" in error)) {
    return false;
  }
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return statusCode === 404 || statusCode === 405;
}

export function isInputEnforcementRequested(request: {
  inputStepPolicy: string;
  inputTimeoutSeconds?: number;
}): boolean {
  return request.inputStepPolicy === "abort" || request.inputTimeoutSeconds !== undefined;
}

interface ResolvedPendingInput {
  id: string;
  signature: string;
  message?: string;
}

export function resolvePendingInputs(
  summary: JenkinsTaskPendingInputSummary
): ResolvedPendingInput[] {
  const inputs = summary.inputs
    ?.map((input) => {
      const signature = input.signature.trim();
      return { id: input.id?.trim() || signature, signature, message: input.message };
    })
    .filter((input) => input.signature.length > 0);
  if (inputs && inputs.length > 0) {
    return Array.from(new Map(inputs.map((input) => [input.id, input] as const)).values());
  }
  const signature = summary.signature ?? `${summary.count}:${summary.message ?? "(no message)"}`;
  return [{ id: signature, signature, message: summary.message }];
}
