import type {
  BuildFailureInsightsViewModel,
  PipelineStageViewModel
} from "./BuildDetailsViewModel";

export interface BuildDetailsUpdateMessage {
  type: "updateDetails";
  resultLabel: string;
  resultClass: string;
  durationLabel: string;
  timestampLabel: string;
  culpritsLabel: string;
  insights: BuildFailureInsightsViewModel;
  pipelineStages: PipelineStageViewModel[];
}

export type BuildDetailsOutgoingMessage =
  | BuildDetailsUpdateMessage
  | { type: "appendConsole"; text: string }
  | { type: "setConsole"; text: string; truncated: boolean }
  | { type: "setErrors"; errors: string[] };

export interface ToggleFollowLogMessage {
  type: "toggleFollowLog";
  value?: unknown;
}

export interface OpenExternalMessage {
  type: "openExternal";
  url: string;
}

export interface ArtifactActionMessage {
  type: "artifactAction";
  action: "preview" | "download";
  relativePath: string;
  fileName?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
