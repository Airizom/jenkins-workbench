import { asRecord, hasMessageType } from "../../../shared/runtimeGuards";
import type { BuildCompareConsoleSectionViewModel } from "./BuildCompareContracts";

export interface SwapBuildsMessage {
  type: "swapBuilds";
}

/** Posted by the webview after mount so the host can re-send pending sections. */
export interface BuildCompareReadyMessage {
  type: "buildCompareReady";
}

export interface OpenBuildDetailsMessage {
  type: "openBuildDetails";
  side: "baseline" | "target";
}

export interface UpdateConsoleSectionMessage {
  type: "updateConsoleSection";
  console: BuildCompareConsoleSectionViewModel;
}

export type BuildCompareOutgoingMessage = UpdateConsoleSectionMessage;
export type BuildCompareIncomingMessage =
  | SwapBuildsMessage
  | OpenBuildDetailsMessage
  | BuildCompareReadyMessage;

export function parseBuildCompareOutgoingMessage(
  message: unknown
): BuildCompareOutgoingMessage | undefined {
  const record = asRecord(message);
  if (!record) {
    return undefined;
  }

  if (record.type !== "updateConsoleSection") {
    return undefined;
  }

  return {
    type: "updateConsoleSection",
    console: (record.console ?? {}) as BuildCompareConsoleSectionViewModel
  };
}

export function isSwapBuildsMessage(message: unknown): message is SwapBuildsMessage {
  return hasMessageType(message, "swapBuilds");
}

export function isBuildCompareReadyMessage(message: unknown): message is BuildCompareReadyMessage {
  return hasMessageType(message, "buildCompareReady");
}

export function isOpenBuildDetailsMessage(message: unknown): message is OpenBuildDetailsMessage {
  return (
    hasMessageType(message, "openBuildDetails") &&
    (message.side === "baseline" || message.side === "target")
  );
}
