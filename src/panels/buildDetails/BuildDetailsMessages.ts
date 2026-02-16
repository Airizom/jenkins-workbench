import type { ArtifactAction, BuildDetailsUpdateMessage } from "./shared/BuildDetailsContracts";

export type { BuildDetailsUpdateMessage } from "./shared/BuildDetailsContracts";

export type BuildDetailsOutgoingMessage =
  | BuildDetailsUpdateMessage
  | { type: "appendConsole"; text: string }
  | { type: "appendConsoleHtml"; html: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setConsoleHtml"; html: string; truncated: boolean }
  | { type: "setErrors"; errors: string[] }
  | { type: "setLoading"; value: boolean };

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

export function isToggleFollowLogMessage(message: unknown): message is ToggleFollowLogMessage {
  if (!isRecord(message)) {
    return false;
  }
  return message.type === "toggleFollowLog";
}

export function isOpenExternalMessage(message: unknown): message is OpenExternalMessage {
  if (!isRecord(message)) {
    return false;
  }
  return message.type === "openExternal" && typeof message.url === "string";
}

export function isExportConsoleMessage(message: unknown): message is ExportConsoleMessage {
  if (!isRecord(message)) {
    return false;
  }
  return message.type === "exportConsole";
}

export function isArtifactActionMessage(message: unknown): message is ArtifactActionMessage {
  if (!isRecord(message)) {
    return false;
  }
  if (message.type !== "artifactAction") {
    return false;
  }
  const action = (message as Record<string, unknown>).action;
  const relativePath = (message as Record<string, unknown>).relativePath;
  if (action !== "preview" && action !== "download") {
    return false;
  }
  return typeof relativePath === "string" && relativePath.length > 0;
}

export function isApproveInputMessage(message: unknown): message is ApproveInputMessage {
  if (!isRecord(message)) {
    return false;
  }
  if (message.type !== "approveInput") {
    return false;
  }
  const inputId = (message as Record<string, unknown>).inputId;
  return typeof inputId === "string" && inputId.length > 0;
}

export function isRejectInputMessage(message: unknown): message is RejectInputMessage {
  if (!isRecord(message)) {
    return false;
  }
  if (message.type !== "rejectInput") {
    return false;
  }
  const inputId = (message as Record<string, unknown>).inputId;
  return typeof inputId === "string" && inputId.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
