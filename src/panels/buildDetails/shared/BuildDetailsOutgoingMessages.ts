import { asRecord, parseSetLoadingOutgoingMessage } from "../../../shared/runtimeGuards";
import type {
  BuildDetailsUpdateMessage,
  BuildDiagnosticsViewModel,
  PipelineNodeLogViewModel
} from "./BuildDetailsContracts";
import { normalizePipelineLogTarget } from "./BuildDetailsContracts";
import { normalizeBuildDiagnosticsViewModel } from "./BuildDetailsDiagnosticsNormalizer";

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
  // Sent once the extension finishes handling an approve/reject request (including any
  // parameter prompt or confirmation), whether it succeeded, failed, or was cancelled.
  | { type: "pendingInputActionComplete"; inputId: string }
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
    case "pendingInputActionComplete": {
      const inputId = record.inputId;
      return typeof inputId === "string" && inputId.length > 0
        ? { type: "pendingInputActionComplete", inputId }
        : undefined;
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
