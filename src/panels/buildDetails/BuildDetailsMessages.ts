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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
