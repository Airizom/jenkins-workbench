import type {
  ArtifactAction,
  BuildDetailsUpdateMessage,
  PipelineLogTargetViewModel
} from "./BuildDetailsContracts";
import { normalizePipelineLogTarget } from "./BuildDetailsContracts";
import {
  type BuildDetailsPanelUiState,
  normalizeBuildDetailsPanelUiState
} from "./BuildDetailsPanelWebviewState";

export type { BuildDetailsUpdateMessage } from "./BuildDetailsContracts";

export type BuildDetailsOutgoingMessage =
  | BuildDetailsUpdateMessage
  | { type: "appendConsole"; text: string }
  | { type: "appendConsoleHtml"; html: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setConsoleHtml"; html: string; truncated: boolean }
  | { type: "setPipelineNodeLog"; log: PipelineNodeLogMessagePayload }
  | { type: "appendPipelineNodeLogHtml"; targetKey: string; html: string }
  | { type: "setPipelineNodeLogLoading"; targetKey?: string; loading: boolean }
  | { type: "setPipelineNodeLogError"; targetKey?: string; error: string }
  | { type: "setErrors"; errors: string[] }
  | { type: "setLoading"; value: boolean };

export interface PipelineNodeLogMessagePayload {
  target?: PipelineLogTargetViewModel;
  html?: string;
  text: string;
  truncated: boolean;
  loading: boolean;
  polling?: boolean;
  error?: string;
  consoleUrl?: string;
}

export interface ToggleFollowLogMessage {
  type: "toggleFollowLog";
  value?: unknown;
}

export interface OpenExternalMessage {
  type: "openExternal";
  url: string;
}

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

export type BuildDetailsIncomingMessage =
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
      return record as unknown as BuildDetailsUpdateMessage;
    }
    case "setErrors": {
      return {
        type: "setErrors",
        errors: Array.isArray(record.errors) ? (record.errors as string[]) : []
      };
    }
    case "setLoading": {
      return {
        type: "setLoading",
        value: Boolean(record.value)
      };
    }
    default:
      return undefined;
  }
}

export function isToggleFollowLogMessage(message: unknown): message is ToggleFollowLogMessage {
  return hasMessageType(message, "toggleFollowLog");
}

export function isOpenExternalMessage(message: unknown): message is OpenExternalMessage {
  if (!hasMessageType(message, "openExternal")) {
    return false;
  }
  return typeof message.url === "string";
}

export function isExportConsoleMessage(message: unknown): message is ExportConsoleMessage {
  return hasMessageType(message, "exportConsole");
}

export function isArtifactActionMessage(message: unknown): message is ArtifactActionMessage {
  if (!hasMessageType(message, "artifactAction")) {
    return false;
  }
  const { action, relativePath } = message;
  if (action !== "preview" && action !== "download") {
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
  return normalizePipelineLogTarget(message.target) !== undefined;
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

export function isPersistUiStateMessage(message: unknown): message is PersistUiStateMessage {
  if (!hasMessageType(message, "persistUiState")) {
    return false;
  }
  return normalizeBuildDetailsPanelUiState(message.uiState) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function hasMessageType<TType extends string>(
  message: unknown,
  type: TType
): message is Record<string, unknown> & { type: TType } {
  return asRecord(message)?.type === type;
}

function parsePipelineNodeLogPayload(value: unknown): PipelineNodeLogMessagePayload | undefined {
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
