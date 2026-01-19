import type {
  JenkinsNodeDetails,
  JenkinsNodeExecutor,
  JenkinsNodeExecutable
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
}

const UNKNOWN_LABEL = "Not available";

export function buildNodeDetailsViewModel(input: NodeDetailsViewModelInput): NodeDetailsViewModel {
  const details = input.details;
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const displayName = details?.displayName?.trim() || details?.name?.trim() || "Node Details";
  const name = details?.name?.trim() || details?.displayName?.trim() || "Unknown";
  const labels = (details?.assignedLabels ?? [])
    .map((label) => label.name?.trim())
    .filter((label): label is string => Boolean(label));

  const status = formatStatus(details);
  const offlineReason = formatOfflineReason(details);
  const idleLabel = formatIdle(details);
  const executorsLabel = formatExecutorsSummary(details);
  const rawJson = details ? JSON.stringify(details, null, 2) : "";
  const advancedLoaded = input.advancedLoaded ?? false;

  return {
    displayName,
    name,
    description: details?.description?.trim() || undefined,
    url: details?.url ?? input.fallbackUrl,
    updatedAt,
    statusLabel: status.label,
    statusClass: status.className,
    offlineReason,
    idleLabel,
    executorsLabel,
    labels,
    jnlpAgentLabel: formatBoolean(details?.jnlpAgent),
    launchSupportedLabel: formatBoolean(details?.launchSupported),
    manualLaunchLabel: formatBoolean(details?.manualLaunchAllowed),
    executors: buildExecutors(details?.executors, "Executor"),
    oneOffExecutors: buildExecutors(details?.oneOffExecutors, "One-off"),
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
  labelPrefix: string
): NodeExecutorViewModel[] {
  if (!Array.isArray(executors) || executors.length === 0) {
    return [];
  }
  return executors.map((executor, index) =>
    buildExecutorViewModel(executor, `${labelPrefix} ${index + 1}`)
  );
}

function buildExecutorViewModel(
  executor: JenkinsNodeExecutor,
  fallbackLabel: string
): NodeExecutorViewModel {
  const number = Number.isFinite(executor.number) ? executor.number : undefined;
  const id = number !== undefined ? `#${number}` : fallbackLabel;
  const workItem = executor.currentExecutable ?? executor.currentWorkUnit;
  const workLabel = formatWorkLabel(workItem);
  const statusLabel = resolveExecutorStatus(executor, Boolean(workItem));
  const progressLabel = formatProgress(executor.progress);

  return {
    id,
    statusLabel,
    progressLabel,
    workLabel,
    workUrl: workItem?.url
  };
}

function resolveExecutorStatus(executor: JenkinsNodeExecutor, hasWork: boolean): string {
  if (executor.idle === true) {
    return "Idle";
  }
  if (executor.idle === false) {
    return "Busy";
  }
  return hasWork ? "Busy" : "Idle";
}

function formatProgress(progress?: number): string | undefined {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return undefined;
  }
  const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
  return `${clamped}%`;
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
