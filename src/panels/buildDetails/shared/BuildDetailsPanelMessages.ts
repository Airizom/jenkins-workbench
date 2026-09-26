import type { BuildDiagnosticSeverity } from "../../../shared/BuildDiagnosticContracts";
import type { OpenExternalMessage } from "../../../shared/runtimeGuards";
import {
  asRecord,
  hasMessageType,
  isOpenExternalMessage,
  parseSetLoadingOutgoingMessage
} from "../../../shared/runtimeGuards";
import type {
  ArtifactAction,
  BuildDetailsUpdateMessage,
  BuildDiagnosticConsoleReference,
  BuildDiagnosticInsightItem,
  BuildDiagnosticsViewModel,
  PipelineLogTargetViewModel,
  PipelineNodeLogViewModel
} from "./BuildDetailsContracts";
import {
  BUILD_DIAGNOSTIC_SCAN_STATUSES,
  isPipelineLogTargetViewModel,
  normalizePipelineLogTarget
} from "./BuildDetailsContracts";
import {
  type BuildDetailsPanelUiState,
  isBuildDetailsPanelUiState,
  normalizeBuildDetailsPanelUiState
} from "./BuildDetailsPanelWebviewState";

export type { BuildDetailsUpdateMessage } from "./BuildDetailsContracts";

export type BuildDetailsOutgoingMessage =
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
  | { type: "setLoading"; value: boolean };

export type BuildDetailsStateMessage = Exclude<
  BuildDetailsOutgoingMessage,
  BuildDetailsUpdateMessage
>;

export interface ToggleFollowLogMessage {
  type: "toggleFollowLog";
  value?: unknown;
}

export type { OpenExternalMessage };

export interface ExportConsoleMessage {
  type: "exportConsole";
}

export interface ArtifactActionMessage {
  type: "artifactAction";
  action: ArtifactAction;
  relativePath: string;
  fileName?: string;
}

export interface ApproveInputMessage {
  type: "approveInput";
  inputId: string;
}

export interface RejectInputMessage {
  type: "rejectInput";
  inputId: string;
}

export interface RestartPipelineFromStageMessage {
  type: "restartPipelineFromStage";
  stageName: string;
}

export interface SelectPipelineLogNodeMessage {
  type: "selectPipelineLogNode";
  target: PipelineLogTargetViewModel;
}

export interface ClearPipelineLogNodeMessage {
  type: "clearPipelineLogNode";
}

export interface ExportPipelineNodeLogMessage {
  type: "exportPipelineNodeLog";
}

export interface ReloadTestReportMessage {
  type: "reloadTestReport";
  includeCaseLogs?: boolean;
}

export interface OpenTestSourceMessage {
  type: "openTestSource";
  testName: string;
  className?: string;
  suiteName?: string;
}

export interface PersistUiStateMessage {
  type: "persistUiState";
  uiState: BuildDetailsPanelUiState;
}

export interface RefreshBuildDetailsMessage {
  type: "refreshBuildDetails";
}

export interface OpenDiagnosticSourceMessage {
  type: "openDiagnosticSource";
  targetId: string;
}

export interface ConfigureBuildDiagnosticsMessage {
  type: "configureBuildDiagnostics";
}

export interface ShowBuildDiagnosticProblemsMessage {
  type: "showBuildDiagnosticProblems";
}

export type BuildDetailsIncomingMessage =
  | RefreshBuildDetailsMessage
  | ToggleFollowLogMessage
  | OpenExternalMessage
  | ExportConsoleMessage
  | ArtifactActionMessage
  | ApproveInputMessage
  | RejectInputMessage
  | RestartPipelineFromStageMessage
  | SelectPipelineLogNodeMessage
  | ClearPipelineLogNodeMessage
  | ExportPipelineNodeLogMessage
  | ReloadTestReportMessage
  | OpenTestSourceMessage
  | OpenDiagnosticSourceMessage
  | ConfigureBuildDiagnosticsMessage
  | ShowBuildDiagnosticProblemsMessage
  | PersistUiStateMessage;

export function parseBuildDetailsOutgoingMessage(
  message: unknown
): BuildDetailsOutgoingMessage | undefined {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  switch (record.type) {
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
      const log = parsePipelineNodeLogPayload(record.log);
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
      return isBuildDetailsUpdateMessage(record) ? record : undefined;
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
    case "setLoading": {
      return parseSetLoadingOutgoingMessage(record);
    }
    default:
      return undefined;
  }
}

export function isToggleFollowLogMessage(message: unknown): message is ToggleFollowLogMessage {
  return hasMessageType(message, "toggleFollowLog");
}

export { isOpenExternalMessage };

export function isExportConsoleMessage(message: unknown): message is ExportConsoleMessage {
  return hasMessageType(message, "exportConsole");
}

export function isRefreshBuildDetailsMessage(
  message: unknown
): message is RefreshBuildDetailsMessage {
  return hasMessageType(message, "refreshBuildDetails");
}

export function isArtifactActionMessage(message: unknown): message is ArtifactActionMessage {
  if (!hasMessageType(message, "artifactAction")) {
    return false;
  }
  const { action, relativePath, fileName } = message;
  if (action !== "preview" && action !== "download") {
    return false;
  }
  if (typeof fileName !== "undefined" && typeof fileName !== "string") {
    return false;
  }
  return typeof relativePath === "string" && relativePath.length > 0;
}

export function isApproveInputMessage(message: unknown): message is ApproveInputMessage {
  if (!hasMessageType(message, "approveInput")) {
    return false;
  }
  const { inputId } = message;
  return typeof inputId === "string" && inputId.length > 0;
}

export function isRejectInputMessage(message: unknown): message is RejectInputMessage {
  if (!hasMessageType(message, "rejectInput")) {
    return false;
  }
  const { inputId } = message;
  return typeof inputId === "string" && inputId.length > 0;
}

export function isRestartPipelineFromStageMessage(
  message: unknown
): message is RestartPipelineFromStageMessage {
  if (!hasMessageType(message, "restartPipelineFromStage")) {
    return false;
  }
  const { stageName } = message;
  return typeof stageName === "string" && stageName.trim().length > 0;
}

export function isSelectPipelineLogNodeMessage(
  message: unknown
): message is SelectPipelineLogNodeMessage {
  if (!hasMessageType(message, "selectPipelineLogNode")) {
    return false;
  }
  return isPipelineLogTargetViewModel(message.target);
}

export function isClearPipelineLogNodeMessage(
  message: unknown
): message is ClearPipelineLogNodeMessage {
  return hasMessageType(message, "clearPipelineLogNode");
}

export function isExportPipelineNodeLogMessage(
  message: unknown
): message is ExportPipelineNodeLogMessage {
  return hasMessageType(message, "exportPipelineNodeLog");
}

export function isReloadTestReportMessage(message: unknown): message is ReloadTestReportMessage {
  if (!hasMessageType(message, "reloadTestReport")) {
    return false;
  }
  return (
    typeof message.includeCaseLogs === "undefined" || typeof message.includeCaseLogs === "boolean"
  );
}

export function isOpenTestSourceMessage(message: unknown): message is OpenTestSourceMessage {
  if (!hasMessageType(message, "openTestSource")) {
    return false;
  }
  const { testName, className, suiteName } = message;
  if (typeof testName !== "string" || testName.trim().length === 0) {
    return false;
  }
  if (typeof className !== "undefined" && typeof className !== "string") {
    return false;
  }
  if (typeof suiteName !== "undefined" && typeof suiteName !== "string") {
    return false;
  }
  return true;
}

export function isOpenDiagnosticSourceMessage(
  message: unknown
): message is OpenDiagnosticSourceMessage {
  if (!hasMessageType(message, "openDiagnosticSource")) {
    return false;
  }
  return typeof message.targetId === "string" && message.targetId.trim().length > 0;
}

export function isConfigureBuildDiagnosticsMessage(
  message: unknown
): message is ConfigureBuildDiagnosticsMessage {
  return hasMessageType(message, "configureBuildDiagnostics");
}

export function isShowBuildDiagnosticProblemsMessage(
  message: unknown
): message is ShowBuildDiagnosticProblemsMessage {
  return hasMessageType(message, "showBuildDiagnosticProblems");
}

export function isPersistUiStateMessage(message: unknown): message is PersistUiStateMessage {
  if (!hasMessageType(message, "persistUiState")) {
    return false;
  }
  return (
    isBuildDetailsPanelUiState(message.uiState) &&
    normalizeBuildDetailsPanelUiState(message.uiState) !== undefined
  );
}

function isBuildDetailsUpdateMessage(
  record: Record<string, unknown>
): record is Record<string, unknown> & BuildDetailsUpdateMessage {
  const stringFields = [
    "resultLabel",
    "resultClass",
    "durationLabel",
    "timestampLabel",
    "culpritsLabel"
  ] as const;
  const recordFields = ["testState", "coverageState", "insights", "pipelineNodeLog"] as const;
  return (
    record.type === "updateDetails" &&
    stringFields.every((field) => typeof record[field] === "string") &&
    typeof record.pipelineStagesLoading === "boolean" &&
    recordFields.every((field) => asRecord(record[field]) !== undefined) &&
    Array.isArray(record.pipelineStages) &&
    Array.isArray(record.pendingInputs)
  );
}

function parsePipelineNodeLogPayload(value: unknown): PipelineNodeLogViewModel | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const target =
    typeof record.target === "undefined" ? undefined : normalizePipelineLogTarget(record.target);
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

function normalizeBuildDiagnosticsViewModel(value: unknown): BuildDiagnosticsViewModel | undefined {
  const record = asRecord(value);
  if (!record || !isBuildDiagnosticScanStatus(record.status)) {
    return undefined;
  }
  const errorCount = parseNonNegativeInteger(record.errorCount);
  const warningCount = parseNonNegativeInteger(record.warningCount);
  const informationCount = parseNonNegativeInteger(record.informationCount);
  const resolvedCount = parseNonNegativeInteger(record.resolvedCount);
  const unresolvedCount = parseNonNegativeInteger(record.unresolvedCount);
  const omittedCount = parseNonNegativeInteger(record.omittedCount);
  if (
    errorCount === undefined ||
    warningCount === undefined ||
    informationCount === undefined ||
    resolvedCount === undefined ||
    unresolvedCount === undefined ||
    omittedCount === undefined ||
    !Array.isArray(record.items) ||
    record.items.length > 5 ||
    !Array.isArray(record.warnings) ||
    !Array.isArray(record.consoleReferences)
  ) {
    return undefined;
  }

  const items = record.items.map(normalizeBuildDiagnosticInsightItem);
  const consoleReferences = record.consoleReferences.map(normalizeBuildDiagnosticConsoleReference);
  if (
    items.some((item) => item === undefined) ||
    consoleReferences.some((reference) => reference === undefined) ||
    record.warnings.some((warning) => typeof warning !== "string") ||
    (typeof record.message !== "undefined" && typeof record.message !== "string")
  ) {
    return undefined;
  }

  return {
    status: record.status,
    errorCount,
    warningCount,
    informationCount,
    resolvedCount,
    unresolvedCount,
    omittedCount,
    items: items as BuildDiagnosticInsightItem[],
    warnings: record.warnings as string[],
    consoleReferences: consoleReferences as BuildDiagnosticConsoleReference[],
    message: typeof record.message === "string" ? record.message : undefined
  };
}

function normalizeBuildDiagnosticInsightItem(
  value: unknown
): BuildDiagnosticInsightItem | undefined {
  const record = asRecord(value);
  if (
    !record ||
    !isBuildDiagnosticSeverity(record.severity) ||
    typeof record.message !== "string" ||
    record.message.trim().length === 0
  ) {
    return undefined;
  }
  const optionalFields = ["locationLabel", "source", "code", "targetId"] as const;
  if (
    optionalFields.some(
      (field) => typeof record[field] !== "undefined" && typeof record[field] !== "string"
    ) ||
    (typeof record.targetId === "string" && record.targetId.trim().length === 0)
  ) {
    return undefined;
  }
  return {
    severity: record.severity,
    message: record.message,
    locationLabel: typeof record.locationLabel === "string" ? record.locationLabel : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
    code: typeof record.code === "string" ? record.code : undefined,
    targetId: typeof record.targetId === "string" ? record.targetId : undefined
  };
}

function normalizeBuildDiagnosticConsoleReference(
  value: unknown
): BuildDiagnosticConsoleReference | undefined {
  const record = asRecord(value);
  const startOffset = record ? parseNonNegativeInteger(record.startOffset) : undefined;
  const endOffset = record ? parseNonNegativeInteger(record.endOffset) : undefined;
  if (
    !record ||
    typeof record.targetId !== "string" ||
    record.targetId.trim().length === 0 ||
    startOffset === undefined ||
    endOffset === undefined ||
    endOffset <= startOffset
  ) {
    return undefined;
  }
  return { targetId: record.targetId, startOffset, endOffset };
}

function parseNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isBuildDiagnosticScanStatus(
  value: unknown
): value is (typeof BUILD_DIAGNOSTIC_SCAN_STATUSES)[number] {
  return BUILD_DIAGNOSTIC_SCAN_STATUSES.some((status) => status === value);
}

function isBuildDiagnosticSeverity(value: unknown): value is BuildDiagnosticSeverity {
  return value === "error" || value === "warning" || value === "information";
}
