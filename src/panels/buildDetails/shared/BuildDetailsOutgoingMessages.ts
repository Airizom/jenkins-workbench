import { asRecord, parseSetLoadingOutgoingMessage } from "../../../shared/runtimeGuards";
import type {
  BuildDetailsUpdateMessage,
  BuildDiagnosticsViewModel,
  BuildNavigationViewModel,
  BuildRelationshipsViewModel,
  PipelineNodeLogViewModel
} from "./BuildDetailsContracts";
import { normalizePipelineLogTarget } from "./BuildDetailsContracts";
import { normalizeBuildDiagnosticsViewModel } from "./BuildDetailsDiagnosticsNormalizer";

export type { BuildDetailsUpdateMessage } from "./BuildDetailsContracts";

export type BuildDetailsOutgoingMessage =
  | { type: "setBuildRelationships"; relationships: BuildRelationshipsViewModel }
  | { type: "setBuildNavigation"; navigation: BuildNavigationViewModel }
  | BuildDetailsUpdateMessage
  | { type: "appendConsole"; text: string }
  | { type: "appendConsoleHtml"; html: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setConsoleHtml"; html: string; truncated: boolean }
  | { type: "setPipelineNodeLog"; log: PipelineNodeLogViewModel }
  | { type: "appendPipelineNodeLogHtml"; targetKey: string; html: string }
  | { type: "setPipelineNodeLogLoading"; targetKey?: string; loading: boolean }
  | { type: "setPipelineNodeLogError"; targetKey?: string; error: string }
  | { type: "setErrors"; errors: string[] }
  | { type: "setBuildDiagnostics"; diagnostics: BuildDiagnosticsViewModel }
  // Sent once the extension finishes handling an approve/reject request (including any
  // parameter prompt or confirmation), whether it succeeded, failed, or was cancelled.
  | { type: "pendingInputActionComplete"; inputId: string }
  // Sent once a keep-forever, edit, or delete request settles (changed, cancelled, or failed)
  // so the webview can re-enable its build management buttons.
  | { type: "buildManagementActionComplete" }
  | { type: "setLoading"; value: boolean };

export type BuildDetailsStateMessage = Exclude<
  BuildDetailsOutgoingMessage,
  BuildDetailsUpdateMessage
>;

export function parseBuildDetailsOutgoingMessage(
  message: unknown
): BuildDetailsOutgoingMessage | undefined {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  switch (record.type) {
    case "setBuildRelationships": {
      return isBuildRelationshipsPayload(record.relationships)
        ? { type: "setBuildRelationships", relationships: record.relationships }
        : undefined;
    }
    case "setBuildNavigation": {
      const navigation = asRecord(record.navigation);
      return navigation &&
        typeof navigation.canGoBack === "boolean" &&
        typeof navigation.canGoForward === "boolean" &&
        typeof navigation.busy === "boolean"
        ? {
            type: "setBuildNavigation",
            navigation: {
              canGoBack: navigation.canGoBack,
              canGoForward: navigation.canGoForward,
              busy: navigation.busy
            }
          }
        : undefined;
    }
    case "appendConsole": {
      const text = record.text;
      if (typeof text === "string" && text.length > 0) {
        return { type: "appendConsole", text };
      }
      return undefined;
    }
    case "appendConsoleHtml": {
      const html = record.html;
      if (typeof html === "string" && html.length > 0) {
        return { type: "appendConsoleHtml", html };
      }
      return undefined;
    }
    case "setConsole": {
      return {
        type: "setConsole",
        text: typeof record.text === "string" ? record.text : "",
        truncated: Boolean(record.truncated)
      };
    }
    case "setConsoleHtml": {
      return {
        type: "setConsoleHtml",
        html: typeof record.html === "string" ? record.html : "",
        truncated: Boolean(record.truncated)
      };
    }
    case "setPipelineNodeLog": {
      const log = parsePipelineNodeLogPayload(record.log, { rejectInvalidTarget: true });
      return log ? { type: "setPipelineNodeLog", log } : undefined;
    }
    case "appendPipelineNodeLogHtml": {
      const targetKey = record.targetKey;
      const html = record.html;
      if (typeof targetKey === "string" && typeof html === "string" && html.length > 0) {
        return { type: "appendPipelineNodeLogHtml", targetKey, html };
      }
      return undefined;
    }
    case "setPipelineNodeLogLoading": {
      return {
        type: "setPipelineNodeLogLoading",
        targetKey: typeof record.targetKey === "string" ? record.targetKey : undefined,
        loading: Boolean(record.loading)
      };
    }
    case "setPipelineNodeLogError": {
      const error = record.error;
      return {
        type: "setPipelineNodeLogError",
        targetKey: typeof record.targetKey === "string" ? record.targetKey : undefined,
        error: typeof error === "string" ? error : "Pipeline log unavailable."
      };
    }
    case "updateDetails": {
      if (!isBuildDetailsUpdateMessage(record)) {
        return undefined;
      }
      const pipelineNodeLog = parsePipelineNodeLogPayload(record.pipelineNodeLog, {
        rejectInvalidTarget: true
      });
      return pipelineNodeLog ? { ...record, pipelineNodeLog } : undefined;
    }
    case "setErrors": {
      if (
        !Array.isArray(record.errors) ||
        record.errors.some((error) => typeof error !== "string")
      ) {
        return undefined;
      }
      return { type: "setErrors", errors: record.errors as string[] };
    }
    case "setBuildDiagnostics": {
      const diagnostics = normalizeBuildDiagnosticsViewModel(record.diagnostics);
      return diagnostics ? { type: "setBuildDiagnostics", diagnostics } : undefined;
    }
    case "pendingInputActionComplete": {
      const inputId = record.inputId;
      return typeof inputId === "string" && inputId.length > 0
        ? { type: "pendingInputActionComplete", inputId }
        : undefined;
    }
    case "buildManagementActionComplete": {
      return { type: "buildManagementActionComplete" };
    }
    case "setLoading": {
      return parseSetLoadingOutgoingMessage(record);
    }
    default:
      return undefined;
  }
}

function isBuildDetailsUpdateMessage(
  record: Record<string, unknown>
): record is Record<string, unknown> & BuildDetailsUpdateMessage {
  const stringFields = [
    "displayName",
    "resultLabel",
    "resultClass",
    "durationLabel",
    "timestampLabel",
    "culpritsLabel"
  ] as const;
  const booleanFields = ["pipelineStagesLoading", "keptForever", "canDelete", "canManage"] as const;
  return (
    record.type === "updateDetails" &&
    stringFields.every((field) => typeof record[field] === "string") &&
    (typeof record.description === "undefined" || typeof record.description === "string") &&
    booleanFields.every((field) => typeof record[field] === "boolean") &&
    isTestStatePayload(record.testState) &&
    isCoverageStatePayload(record.coverageState) &&
    isInsightsPayload(record.insights) &&
    asRecord(record.pipelineNodeLog) !== undefined &&
    Array.isArray(record.pipelineStages) &&
    record.pipelineStages.every(isPipelineStagePayload) &&
    Array.isArray(record.pendingInputs)
  );
}

function isTestStatePayload(value: unknown): boolean {
  const record = asRecord(value);
  const summary = asRecord(record?.summary);
  const results = asRecord(record?.results);
  const countFields = ["totalCount", "failedCount", "skippedCount", "passedCount"] as const;
  return (
    summary !== undefined &&
    countFields.every((field) => typeof summary[field] === "number") &&
    typeof summary.summaryLabel === "string" &&
    results !== undefined &&
    Array.isArray(results.items) &&
    typeof results.loading === "boolean"
  );
}

function isCoverageStatePayload(value: unknown): boolean {
  const record = asRecord(value);
  return (
    record !== undefined &&
    typeof record.status === "string" &&
    Array.isArray(record.qualityGates) &&
    Array.isArray(record.modifiedFiles)
  );
}

function isInsightsPayload(value: unknown): boolean {
  const record = asRecord(value);
  return (
    record !== undefined &&
    Array.isArray(record.changelogItems) &&
    Array.isArray(record.artifacts) &&
    typeof record.testSummaryLabel === "string"
  );
}

function isPipelineStagePayload(value: unknown): boolean {
  const record = asRecord(value);
  return (
    record !== undefined &&
    typeof record.key === "string" &&
    typeof record.name === "string" &&
    Array.isArray(record.stepsFailedOnly) &&
    Array.isArray(record.stepsAll) &&
    Array.isArray(record.parallelBranches) &&
    record.parallelBranches.every(isPipelineStagePayload)
  );
}

function parsePipelineNodeLogPayload(
  value: unknown,
  options: { rejectInvalidTarget?: boolean } = {}
): PipelineNodeLogViewModel | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const target =
    typeof record.target === "undefined" ? undefined : normalizePipelineLogTarget(record.target);
  // A target that was sent but failed validation must not be treated as "no target",
  // or the log would be applied to the wrong (or no) pipeline node.
  if (options.rejectInvalidTarget && typeof record.target !== "undefined" && !target) {
    return undefined;
  }
  const html = typeof record.html === "string" ? record.html : undefined;
  return {
    target,
    html,
    text: typeof record.text === "string" ? record.text : "",
    truncated: Boolean(record.truncated),
    loading: Boolean(record.loading),
    polling: typeof record.polling === "undefined" ? undefined : Boolean(record.polling),
    error: typeof record.error === "string" ? record.error : undefined,
    consoleUrl: typeof record.consoleUrl === "string" ? record.consoleUrl : undefined
  };
}

function isBuildRelationshipsPayload(value: unknown): value is BuildRelationshipsViewModel {
  const record = asRecord(value);
  if (!record) return false;
  const isEntry = (value: unknown): boolean => {
    const entry = asRecord(value);
    return Boolean(
      entry &&
        typeof entry.targetId === "string" &&
        entry.targetId.trim() &&
        typeof entry.jobName === "string" &&
        entry.jobName.trim() &&
        Number.isSafeInteger(entry.number) &&
        (entry.number as number) > 0 &&
        (entry.resultLabel === undefined || typeof entry.resultLabel === "string") &&
        (entry.resultClass === undefined || typeof entry.resultClass === "string")
    );
  };
  return (
    Array.isArray(record.upstream) &&
    record.upstream.every(isEntry) &&
    Array.isArray(record.downstream) &&
    record.downstream.every(isEntry) &&
    typeof record.loading === "boolean" &&
    typeof record.searched === "boolean" &&
    Number.isSafeInteger(record.jobsSearched) &&
    (record.jobsSearched as number) >= 0 &&
    Number.isSafeInteger(record.buildsSearched) &&
    (record.buildsSearched as number) >= 0 &&
    Array.isArray(record.partialReasons) &&
    record.partialReasons.every((reason) => typeof reason === "string") &&
    (record.lastCheckedAt === undefined ||
      (typeof record.lastCheckedAt === "number" &&
        Number.isFinite(record.lastCheckedAt) &&
        record.lastCheckedAt >= 0 &&
        record.lastCheckedAt <= 8_640_000_000_000_000)) &&
    (record.error === undefined || typeof record.error === "string")
  );
}
