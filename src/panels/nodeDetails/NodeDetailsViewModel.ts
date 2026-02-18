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
const MONITOR_STRING_KEYS = ["message", "status", "state", "description", "name"] as const;
const MONITOR_NUMBER_KEYS = ["size", "count", "total"] as const;
const STATUS_DESCRIPTORS = {
  unknown: { label: "Unknown", className: "unknown" },
  temporary: { label: "Temporarily Offline", className: "temporary" },
  offline: { label: "Offline", className: "offline" },
  idle: { label: "Idle", className: "idle" },
  online: { label: "Online", className: "online" }
} as const satisfies Record<string, NodeStatusDescriptor>;

interface NodeStatusDescriptor {
  label: string;
  className: NodeStatusClass;
}

interface DurationResult {
  label?: string;
  ms?: number;
}

type NodeIdentityFields = Pick<
  NodeDetailsViewModel,
  "displayName" | "name" | "description" | "url" | "updatedAt"
>;

type NodeStatusFields = Pick<
  NodeDetailsViewModel,
  | "statusLabel"
  | "statusClass"
  | "isOffline"
  | "isTemporarilyOffline"
  | "canTakeOffline"
  | "canBringOnline"
  | "canLaunchAgent"
  | "canOpenAgentInstructions"
  | "offlineReason"
>;

type NodeOverviewFields = Pick<
  NodeDetailsViewModel,
  | "idleLabel"
  | "executorsLabel"
  | "labels"
  | "jnlpAgentLabel"
  | "launchSupportedLabel"
  | "manualLaunchLabel"
>;

type NodeRuntimeFields = Pick<
  NodeDetailsViewModel,
  "executors" | "oneOffExecutors" | "monitorData" | "loadStatistics" | "rawJson"
>;

export function buildNodeDetailsViewModel(input: NodeDetailsViewModelInput): NodeDetailsViewModel {
  const details = input.details;
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const nowMs = resolveNowMs(input.nowMs, updatedAt);

  return {
    ...buildNodeIdentity(details, input.fallbackUrl, updatedAt),
    ...buildNodeStatus(details),
    ...buildNodeOverview(details),
    ...buildNodeRuntimeFields(details, nowMs),
    errors: [...input.errors],
    advancedLoaded: Boolean(input.advancedLoaded)
  };
}

function buildNodeIdentity(
  details: JenkinsNodeDetails | undefined,
  fallbackUrl: string | undefined,
  updatedAt: string
): NodeIdentityFields {
  return {
    displayName: firstNonEmpty(details?.displayName, details?.name) ?? "Node Details",
    name: firstNonEmpty(details?.name, details?.displayName) ?? "Unknown",
    description: trimToUndefined(details?.description),
    url: firstNonEmpty(details?.url, fallbackUrl),
    updatedAt
  };
}

function buildNodeStatus(details?: JenkinsNodeDetails): NodeStatusFields {
  const status = formatStatus(details);
  const capabilities = buildNodeActionCapabilities(details);

  return {
    statusLabel: status.label,
    statusClass: status.className,
    ...capabilities,
    offlineReason: formatOfflineReason(details)
  };
}

function buildNodeOverview(details?: JenkinsNodeDetails): NodeOverviewFields {
  return {
    idleLabel: formatIdle(details),
    executorsLabel: formatExecutorsSummary(details),
    labels: collectAssignedLabelNames(details?.assignedLabels),
    jnlpAgentLabel: formatBoolean(details?.jnlpAgent),
    launchSupportedLabel: formatBoolean(details?.launchSupported),
    manualLaunchLabel: formatBoolean(details?.manualLaunchAllowed)
  };
}

function buildNodeRuntimeFields(
  details: JenkinsNodeDetails | undefined,
  nowMs: number
): NodeRuntimeFields {
  return {
    executors: buildExecutors(details?.executors, "Executor", nowMs),
    oneOffExecutors: buildExecutors(details?.oneOffExecutors, "One-off", nowMs),
    monitorData: buildMonitorEntries(details?.monitorData),
    loadStatistics: buildMonitorEntries(details?.loadStatistics),
    rawJson: stringifyNodeDetails(details)
  };
}

function formatStatus(details?: JenkinsNodeDetails): NodeStatusDescriptor {
  if (!details) {
    return STATUS_DESCRIPTORS.unknown;
  }
  if (details.offline === true) {
    return details.temporarilyOffline ? STATUS_DESCRIPTORS.temporary : STATUS_DESCRIPTORS.offline;
  }
  if (details.idle === true) {
    return STATUS_DESCRIPTORS.idle;
  }
  if (details.offline === false) {
    return STATUS_DESCRIPTORS.online;
  }
  return STATUS_DESCRIPTORS.unknown;
}

function formatOfflineReason(details?: JenkinsNodeDetails): string | undefined {
  return firstNonEmpty(
    details?.offlineCauseReason,
    details?.offlineCause?.description,
    details?.offlineCause?.shortDescription
  );
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
  if (isFiniteNumber(total) && isFiniteNumber(busy)) {
    return `Busy ${busy}/${total}`;
  }
  if (isFiniteNumber(total)) {
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
  if (!Array.isArray(executors)) {
    return [];
  }

  return executors.map((executor, index) => {
    const fallbackLabel = `${labelPrefix} ${index + 1}`;
    return buildExecutorViewModel(executor, fallbackLabel, nowMs);
  });
}

function buildExecutorViewModel(
  executor: JenkinsNodeExecutor,
  fallbackLabel: string,
  nowMs: number
): NodeExecutorViewModel {
  const workItem = executor.currentExecutable ?? executor.currentWorkUnit;
  const isIdle = resolveExecutorIdle(executor, workItem);
  const progressPercent = normalizeProgressPercent(executor.progress);
  const workDuration = resolveWorkDuration(workItem, nowMs);

  return {
    id: formatExecutorId(executor.number, fallbackLabel),
    statusLabel: isIdle ? "Idle" : "Busy",
    isIdle,
    progressPercent,
    progressLabel: formatProgress(progressPercent),
    workLabel: formatWorkLabel(workItem),
    workUrl: trimToUndefined(workItem?.url),
    workDurationLabel: workDuration.label,
    workDurationMs: workDuration.ms
  };
}

function formatExecutorId(number: number | undefined, fallbackLabel: string): string {
  return isFiniteNumber(number) ? `#${number}` : fallbackLabel;
}

function resolveExecutorIdle(
  executor: JenkinsNodeExecutor,
  workItem: JenkinsNodeExecutable | undefined
): boolean {
  return !workItem && executor.idle !== false;
}

function normalizeProgressPercent(progress?: number): number | undefined {
  if (!isFiniteNumber(progress)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.floor(progress)));
}

function formatProgress(progressPercent?: number): string | undefined {
  if (!isFiniteNumber(progressPercent)) {
    return undefined;
  }
  return `${progressPercent}%`;
}

function formatWorkLabel(work?: JenkinsNodeExecutable): string | undefined {
  if (!work) {
    return undefined;
  }

  const name =
    firstNonEmpty(work.fullDisplayName, work.displayName) ??
    (isFiniteNumber(work.number) ? `#${work.number}` : undefined) ??
    trimToUndefined(work.url);
  const result = trimToUndefined(work.result);

  if (name && result) {
    return `${name} (${result})`;
  }
  return name;
}

function resolveWorkDuration(
  work: JenkinsNodeExecutable | undefined,
  nowMs: number
): DurationResult {
  if (!work) {
    return {};
  }

  const isBuilding = work.building === true;
  const durationValue = toValidMs(work.duration);
  if (durationValue !== undefined && (durationValue > 0 || !isBuilding)) {
    return buildDurationResult(durationValue);
  }

  if (isBuilding) {
    const timestamp = toValidMs(work.timestamp);
    if (timestamp !== undefined) {
      return buildDurationResult(Math.max(0, nowMs - timestamp));
    }
  }

  const estimatedValue = toValidMs(work.estimatedDuration);
  if (estimatedValue !== undefined && estimatedValue > 0) {
    return buildDurationResult(estimatedValue, "Est. ");
  }

  return {};
}

function buildDurationResult(duration: number, prefix = ""): DurationResult {
  return { label: `${prefix}${formatDurationMs(duration)}`, ms: duration };
}

function toValidMs(value?: number): number | undefined {
  if (!isFiniteNumber(value) || value < 0) {
    return undefined;
  }
  return value;
}

function buildMonitorEntries(data?: Record<string, unknown>): NodeMonitorViewModel[] {
  if (!isRecord(data)) {
    return [];
  }

  return Object.entries(data)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => ({
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
  if (isRecord(value)) {
    const candidate =
      pickString(value, MONITOR_STRING_KEYS) ?? pickNumber(value, MONITOR_NUMBER_KEYS);
    if (candidate !== undefined) {
      return candidate;
    }
    const keys = Object.keys(value);
    return keys.length > 0 ? `${keys.length} fields` : "Empty object";
  }
  return UNKNOWN_LABEL;
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = trimToUndefined(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isFiniteNumber(value)) {
      return String(value);
    }
  }
  return undefined;
}

function stringifyNodeDetails(details?: JenkinsNodeDetails): string {
  if (!details) {
    return "";
  }

  const seen = new WeakSet<object>();
  return JSON.stringify(
    details,
    (_key, value) => {
      if (!isRecord(value)) {
        return value;
      }
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
      return value;
    },
    2
  );
}

function resolveNowMs(nowMs: number | undefined, updatedAt: string): number {
  if (isFiniteNumber(nowMs)) {
    return nowMs;
  }
  const parsedUpdatedAt = Date.parse(updatedAt);
  return Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = trimToUndefined(value);
    if (trimmed !== undefined) {
      return trimmed;
    }
  }
  return undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
