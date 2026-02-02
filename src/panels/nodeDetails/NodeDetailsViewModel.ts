import { formatDurationMs } from "../../formatters/DurationFormatters";
import { collectAssignedLabelNames } from "../../jenkins/labels";
import { buildNodeActionCapabilities } from "../../jenkins/nodeActionCapabilities";
import type {
  JenkinsNodeDetails,
  JenkinsNodeExecutable,
  JenkinsNodeExecutor
} from "../../jenkins/types";
import type {
  NodeDetailsViewModel,
  NodeExecutorViewModel,
  NodeMonitorViewModel,
  NodeStatusClass
} from "./shared/NodeDetailsContracts";

export type {
  NodeDetailsViewModel,
  NodeExecutorViewModel,
  NodeMonitorViewModel,
  NodeStatusClass
} from "./shared/NodeDetailsContracts";

export interface NodeDetailsViewModelInput {
  details?: JenkinsNodeDetails;
  errors: string[];
  updatedAt?: string;
  fallbackUrl?: string;
  advancedLoaded?: boolean;
  nowMs?: number;
}

const UNKNOWN_LABEL = "Not available";

export function buildNodeDetailsViewModel(input: NodeDetailsViewModelInput): NodeDetailsViewModel {
  const details = input.details;
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const displayName = details?.displayName?.trim() || details?.name?.trim() || "Node Details";
  const name = details?.name?.trim() || details?.displayName?.trim() || "Unknown";
  const labels = collectAssignedLabelNames(details?.assignedLabels);

  const status = formatStatus(details);
  const capabilities = buildNodeActionCapabilities(details);
  const isOffline = capabilities.isOffline;
  const isTemporarilyOffline = capabilities.isTemporarilyOffline;
  const canTakeOffline = capabilities.canTakeOffline;
  const canBringOnline = capabilities.canBringOnline;
  const canLaunchAgent = capabilities.canLaunchAgent;
  const canOpenAgentInstructions = capabilities.canOpenAgentInstructions;
  const offlineReason = formatOfflineReason(details);
  const idleLabel = formatIdle(details);
  const executorsLabel = formatExecutorsSummary(details);
  const rawJson = details ? JSON.stringify(details, null, 2) : "";
  const advancedLoaded = input.advancedLoaded ?? false;
  const nowMsCandidate =
    typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
      ? input.nowMs
      : Date.parse(updatedAt);
  const nowMs = Number.isFinite(nowMsCandidate) ? nowMsCandidate : 0;

  return {
    displayName,
    name,
    description: details?.description?.trim() || undefined,
    url: details?.url ?? input.fallbackUrl,
    updatedAt,
    statusLabel: status.label,
    statusClass: status.className,
    isOffline,
    isTemporarilyOffline,
    canTakeOffline,
    canBringOnline,
    canLaunchAgent,
    canOpenAgentInstructions,
    offlineReason,
    idleLabel,
    executorsLabel,
    labels,
    jnlpAgentLabel: formatBoolean(details?.jnlpAgent),
    launchSupportedLabel: formatBoolean(details?.launchSupported),
    manualLaunchLabel: formatBoolean(details?.manualLaunchAllowed),
    executors: buildExecutors(details?.executors, "Executor", nowMs),
    oneOffExecutors: buildExecutors(details?.oneOffExecutors, "One-off", nowMs),
    monitorData: buildMonitorEntries(details?.monitorData),
    loadStatistics: buildMonitorEntries(details?.loadStatistics),
    rawJson,
    errors: input.errors,
    advancedLoaded
  };
}

function formatStatus(details?: JenkinsNodeDetails): { label: string; className: NodeStatusClass } {
  if (!details) {
    return { label: "Unknown", className: "unknown" };
  }
  if (details.offline) {
    if (details.temporarilyOffline) {
      return { label: "Temporarily Offline", className: "temporary" };
    }
    return { label: "Offline", className: "offline" };
  }
  if (details.idle === true) {
    return { label: "Idle", className: "idle" };
  }
  if (details.offline === false) {
    return { label: "Online", className: "online" };
  }
  return { label: "Unknown", className: "unknown" };
}

function formatOfflineReason(details?: JenkinsNodeDetails): string | undefined {
  const reason =
    details?.offlineCauseReason?.trim() ||
    details?.offlineCause?.description?.trim() ||
    details?.offlineCause?.shortDescription?.trim();
  return reason && reason.length > 0 ? reason : undefined;
}

function formatIdle(details?: JenkinsNodeDetails): string {
  if (!details) {
    return UNKNOWN_LABEL;
  }
  if (details.idle === true) {
    return "Idle";
  }
  if (details.idle === false) {
    return "Busy";
  }
  return UNKNOWN_LABEL;
}

function formatExecutorsSummary(details?: JenkinsNodeDetails): string {
  const total = details?.numExecutors;
  const busy = details?.busyExecutors;
  if (Number.isFinite(total) && Number.isFinite(busy)) {
    return `Busy ${busy}/${total}`;
  }
  if (Number.isFinite(total)) {
    return `${total} total`;
  }
  return UNKNOWN_LABEL;
}

function formatBoolean(value?: boolean): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value ? "Yes" : "No";
}

function buildExecutors(
  executors: JenkinsNodeExecutor[] | undefined,
  labelPrefix: string,
  nowMs: number
): NodeExecutorViewModel[] {
  if (!Array.isArray(executors) || executors.length === 0) {
    return [];
  }
  return executors.map((executor, index) =>
    buildExecutorViewModel(executor, `${labelPrefix} ${index + 1}`, nowMs)
  );
}

function buildExecutorViewModel(
  executor: JenkinsNodeExecutor,
  fallbackLabel: string,
  nowMs: number
): NodeExecutorViewModel {
  const number = Number.isFinite(executor.number) ? executor.number : undefined;
  const id = number !== undefined ? `#${number}` : fallbackLabel;
  const workItem = executor.currentExecutable ?? executor.currentWorkUnit;
  const workLabel = formatWorkLabel(workItem);
  const isIdle = resolveExecutorIdle(executor, Boolean(workItem));
  const statusLabel = isIdle ? "Idle" : "Busy";
  const progressPercent = normalizeProgressPercent(executor.progress);
  const progressLabel = formatProgress(progressPercent);
  const workDuration = resolveWorkDuration(workItem, nowMs);

  return {
    id,
    statusLabel,
    isIdle,
    progressPercent,
    progressLabel,
    workLabel,
    workUrl: workItem?.url,
    workDurationLabel: workDuration.label,
    workDurationMs: workDuration.ms
  };
}

function resolveExecutorIdle(executor: JenkinsNodeExecutor, hasWork: boolean): boolean {
  return !hasWork && executor.idle !== false;
}

function normalizeProgressPercent(progress?: number): number | undefined {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.floor(progress)));
}

function formatProgress(progressPercent?: number): string | undefined {
  if (typeof progressPercent !== "number" || !Number.isFinite(progressPercent)) {
    return undefined;
  }
  return `${progressPercent}%`;
}

function formatWorkLabel(work?: JenkinsNodeExecutable): string | undefined {
  if (!work) {
    return undefined;
  }
  const name =
    work.fullDisplayName?.trim() ||
    work.displayName?.trim() ||
    (Number.isFinite(work.number) ? `#${work.number}` : undefined) ||
    work.url;
  const result = work.result?.trim();
  if (name && result) {
    return `${name} (${result})`;
  }
  return name;
}

function resolveWorkDuration(
  work: JenkinsNodeExecutable | undefined,
  nowMs: number
): { label?: string; ms?: number } {
  if (!work) {
    return {};
  }

  const isBuilding = work.building === true;
  const durationValue = normalizeDuration(work.duration);
  if (durationValue !== undefined && (durationValue > 0 || !isBuilding)) {
    return buildDurationResult(durationValue);
  }

  if (isBuilding) {
    const timestamp = normalizeDuration(work.timestamp);
    if (timestamp !== undefined) {
      const elapsed = Math.max(0, nowMs - timestamp);
      return buildDurationResult(elapsed);
    }
  }

  const estimatedValue = normalizeDuration(work.estimatedDuration);
  if (estimatedValue !== undefined && estimatedValue > 0) {
    return buildDurationResult(estimatedValue, "Est. ");
  }

  return {};
}

function buildDurationResult(duration: number, prefix = ""): { label: string; ms: number } {
  return { label: `${prefix}${formatDurationMs(duration)}`, ms: duration };
}

function normalizeDuration(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function buildMonitorEntries(data?: Record<string, unknown>): NodeMonitorViewModel[] {
  if (!data || typeof data !== "object") {
    return [];
  }
  return Object.entries(data).map(([key, value]) => ({
    key,
    summary: summarizeMonitorValue(value),
    raw: value
  }));
}

function summarizeMonitorValue(value: unknown): string {
  if (value === null || value === undefined) {
    return UNKNOWN_LABEL;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length} items` : "Empty list";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate =
      pickString(record, ["message", "status", "state", "description", "name"]) ??
      pickNumber(record, ["size", "count", "total"]);
    if (candidate) {
      return candidate;
    }
    const keys = Object.keys(record);
    return keys.length > 0 ? `${keys.length} fields` : "Empty object";
  }
  return UNKNOWN_LABEL;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}
